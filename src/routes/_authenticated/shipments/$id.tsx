import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, StatCard, EmptyState } from "@/components/cards";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { COUNTRY_DAYS, calcArrivalDate, toDateInputValue } from "@/lib/arrival";
import { allocateTransport, fmtMoney, fmtKg, fmtPct, productTotalWeight } from "@/lib/transport";

export const Route = createFileRoute("/_authenticated/shipments/$id")({
  component: ShipmentDetail,
});

const DISTRIBUTION_LOCKED_STATUSES = new Set(["distributing", "completed"]);
type Tab = "products" | "distribution" | "requests" | "history" | "logistics";

function ShipmentDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("products");

  const { data } = useQuery({
    queryKey: ["shipment", id],
    queryFn: async () => {
      const [s, items, dists, reqs, changes] = await Promise.all([
        supabase.from("shipments").select("*, suppliers(name,country)").eq("id", id).single(),
        supabase.from("shipment_items").select("*").eq("shipment_id", id).order("created_at"),
        supabase
          .from("distributions")
          .select("id,branch_id,status,branches:branch_id(name,sort_order),distribution_items(pallets,qty,shipment_item_id)")
          .eq("shipment_id", id),
        supabase.from("branch_requests").select("id,status,request_type,qty,approved_qty,notes,branch_id,created_at").eq("shipment_id", id).order("created_at", { ascending: false }),
        supabase.from("shipment_item_changes").select("id,field,old_value,new_value,created_at").eq("shipment_id", id).order("created_at", { ascending: false }).limit(40),
      ]);
      return {
        shipment: s.data,
        items: items.data ?? [],
        distributions: dists.data ?? [],
        requests: reqs.data ?? [],
        changes: changes.data ?? [],
      };
    },
  });

  const sh = data?.shipment;
  if (!sh) return <p className="text-sm text-muted-foreground">Завантаження…</p>;

  const fact = (data!.items ?? []).reduce((a, it) => a + Number(it.pallet_count ?? 0), 0);
  const distributed = (data!.distributions ?? []).reduce(
    (a, d) => a + (d.distribution_items ?? []).reduce((aa, di) => aa + Number(di.pallets ?? 0), 0), 0);

  const TABS: { key: Tab; label: string }[] = [
    { key: "products", label: "Товари" },
    { key: "distribution", label: "Розподіл" },
    { key: "requests", label: "Заявки" },
    { key: "history", label: "Історія змін" },
    { key: "logistics", label: "Логістика" },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={sh.code}
        subtitle={sh.suppliers?.name ?? sh.country ?? ""}
        action={<StatusChip status={sh.status} />}
      />

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="FACT палет" value={fact} tone="primary" />
        <StatCard label="Розподілено" value={distributed} tone="brand" />
        <StatCard label="Залишок" value={fact - distributed} />
        <StatCard label="ETA" value={sh.eta ?? "—"} />
      </div>

      <div className="-mx-4 overflow-x-auto px-4">
        <div className="flex gap-2 pb-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "shrink-0 rounded-full border px-4 py-1.5 text-xs font-semibold transition",
                tab === t.key
                  ? "border-brand bg-brand text-brand-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "products" && <ProductsTab items={data!.items} shipmentId={id} />}
      {tab === "distribution" && <DistributionTab distributions={data!.distributions} shipmentId={id} />}
      {tab === "requests" && <RequestsTab requests={data!.requests} qc={qc} />}
      {tab === "history" && <HistoryTab changes={data!.changes} />}
      {tab === "logistics" && <LogisticsTab shipment={sh} shipmentId={id} qc={qc} />}
    </div>
  );
}

function ProductsTab({ items, shipmentId }: { items: Item[]; shipmentId: string }) {
  const qc = useQueryClient();
  const addItem = async () => {
    const { error } = await supabase.from("shipment_items").insert({
      shipment_id: shipmentId, product_name: "Новий товар", qty: 0, unit: "kg",
      unit_price: 0, pallet_count: 0, pallet_weight: 0, invoice_price: 0, indicative_price: 0,
    });
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["shipment", shipmentId] });
  };
  return (
    <SectionCard
      title="Товари поставки"
      action={
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={addItem}>+ Позиція</Button>
          <Link to="/distribution/$shipmentId" params={{ shipmentId }}>
            <Button size="sm" className="bg-brand text-brand-foreground hover:bg-brand/90">Розподіл</Button>
          </Link>
        </div>
      }
    >
      {!items.length ? <EmptyState title="Позицій ще немає" /> : (
        <div className="space-y-2">
          {items.map((it) => <ShipmentItemRow key={it.id} item={it as Item} shipmentId={shipmentId} />)}
        </div>
      )}
    </SectionCard>
  );
}

type DistRow = { id: string; branch_id: string; status: string; branches: { name: string | null; sort_order: number | null } | null; distribution_items: Array<{ pallets: number | null; qty: number | null; shipment_item_id: string }> | null };
function DistributionTab({ distributions, shipmentId }: { distributions: DistRow[]; shipmentId: string }) {
  const branches = (distributions ?? [])
    .map((d) => ({
      id: d.id,
      branch_id: d.branch_id,
      name: d.branches?.name ?? "—",
      sort: d.branches?.sort_order ?? 99,
      pallets: (d.distribution_items ?? []).reduce((a, di) => a + Number(di.pallets ?? 0), 0),
      kg: (d.distribution_items ?? []).reduce((a, di) => a + Number(di.qty ?? 0), 0),
      status: d.status,
    }))
    .sort((a, b) => a.sort - b.sort);
  return (
    <SectionCard
      title="Філії"
      action={
        <Link to="/distribution/$shipmentId" params={{ shipmentId }}>
          <Button size="sm" className="bg-brand text-brand-foreground hover:bg-brand/90">Матриця</Button>
        </Link>
      }
    >
      {!branches.length ? <EmptyState title="Розподіл ще не зроблено" /> : (
        <ul className="divide-y divide-border">
          {branches.map((b) => (
            <li key={b.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <div className="font-semibold">{b.name}</div>
                <div className="text-xs text-muted-foreground">{b.pallets} палет · {Math.round(b.kg)} кг</div>
              </div>
              <StatusChip status={b.status} kind="distribution" />
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function RequestsTab({ requests, qc }: { requests: { id: string; status: string; request_type: string | null; qty: number | null; approved_qty: number | null; notes: string | null; created_at: string }[]; qc: ReturnType<typeof useQueryClient> }) {
  const update = async (rid: string, patch: Record<string, unknown>) => {
    const { error } = await supabase.from("branch_requests").update(patch as never).eq("id", rid);
    if (error) return toast.error(error.message);
    toast.success("Оновлено");
    qc.invalidateQueries();
  };
  return (
    <SectionCard title="Заявки філій по поставці">
      {!requests.length ? <EmptyState title="Заявок немає" /> : (
        <ul className="divide-y divide-border">
          {requests.map((r) => (
            <li key={r.id} className="space-y-2 py-3 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">{REQ_TYPE_LABEL[r.request_type ?? "more"]}</div>
                  <div className="text-xs text-muted-foreground">Запит: {r.qty ?? 0} {r.approved_qty != null && <>· затв.: <b className="text-brand">{r.approved_qty}</b></>}</div>
                </div>
                <StatusChip status={r.status} kind="branch_request" />
              </div>
              {r.notes && <p className="text-xs text-muted-foreground">{r.notes}</p>}
              {r.status === "pending" && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" className="bg-success text-white hover:bg-success/90" onClick={() => update(r.id, { status: "approved", approved_qty: r.qty })}>Затвердити</Button>
                  <Button size="sm" variant="secondary" onClick={() => {
                    const v = prompt("Скільки затвердити?", String(r.qty ?? 0));
                    if (v !== null) update(r.id, { status: "approved", approved_qty: Number(v) });
                  }}>Частково</Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => update(r.id, { status: "rejected" })}>Відхилити</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function HistoryTab({ changes }: { changes: { id: string; field: string; old_value: string | null; new_value: string | null; created_at: string }[] }) {
  return (
    <SectionCard title="Журнал змін">
      {!changes.length ? <EmptyState title="Змін немає" /> : (
        <ul className="divide-y divide-border text-xs">
          {changes.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-2">
              <div>
                <span className="font-semibold uppercase">{c.field}</span>
                <span className="ml-2 text-muted-foreground">
                  {c.old_value ?? "—"} → <span className="font-semibold text-brand">{c.new_value ?? "—"}</span>
                </span>
              </div>
              <span className="text-muted-foreground">{new Date(c.created_at).toLocaleString("uk-UA")}</span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function LogisticsTab({ shipment, shipmentId, qc }: { shipment: { status: string; eta: string | null; loading_date: string | null; logistics_days: number | null; country: string | null }; shipmentId: string; qc: ReturnType<typeof useQueryClient> }) {
  const [eta, setEta] = useState<string>("");
  const etaLocked = DISTRIBUTION_LOCKED_STATUSES.has(shipment.status);
  const currentEta = eta || shipment.eta || "";

  const recompute = () => {
    if (!shipment.loading_date) return;
    const days = shipment.logistics_days ?? (shipment.country ? COUNTRY_DAYS[shipment.country] ?? 0 : 0);
    setEta(toDateInputValue(calcArrivalDate(shipment.loading_date, days)));
  };
  const saveEta = async () => {
    const { error } = await supabase.from("shipments").update({ eta: currentEta || null }).eq("id", shipmentId);
    if (error) return toast.error(error.message);
    toast.success("ETA оновлено");
    qc.invalidateQueries({ queryKey: ["shipment", shipmentId] });
  };
  const setStatus = async (status: string) => {
    const { error } = await supabase.from("shipments").update({ status: status as "arrived" }).eq("id", shipmentId);
    if (error) return toast.error(error.message);
    toast.success("Статус оновлено");
    qc.invalidateQueries({ queryKey: ["shipment", shipmentId] });
  };

  return (
    <div className="space-y-4">
      <SectionCard title="Дата прибуття">
        <div className="space-y-2">
          <Label htmlFor="eta">{etaLocked ? "Розподіл розпочато — редагування заблоковано" : "Можна редагувати до старту розподілу"}</Label>
          <div className="flex gap-2">
            <Input id="eta" type="date" value={currentEta} onChange={(e) => setEta(e.target.value)} disabled={etaLocked} />
            <Button type="button" variant="secondary" onClick={recompute} disabled={etaLocked}>Перерахувати</Button>
            <Button type="button" onClick={saveEta} disabled={etaLocked} className="bg-brand text-brand-foreground hover:bg-brand/90">Зберегти</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Завантаження: {shipment.loading_date ?? "—"} · Країна: {shipment.country ?? "—"} · Дні: {shipment.logistics_days ?? "—"}
          </p>
        </div>
      </SectionCard>

      <SectionCard title="Зміна статусу">
        <div className="flex flex-wrap gap-2">
          {(["draft","loading","in_transit","customs","arrived","distributing","completed","delayed","cancelled"] as const).map((s) => (
            <button key={s} onClick={() => setStatus(s)}
              className={cn("rounded-full border px-3 py-1 text-xs font-semibold",
                shipment.status === s ? "border-brand bg-brand text-brand-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground")}>
              {s}
            </button>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

const REQ_TYPE_LABEL: Record<string, string> = {
  more: "Більше палет",
  transfer: "Переміщення між філіями",
  reserve: "Резервування",
};

// Helper type
function useShipmentData() {
  return null as unknown as {
    shipment: { status: string; eta: string | null; loading_date: string | null; logistics_days: number | null; country: string | null; code: string; suppliers: { name: string | null; country: string | null } | null };
    items: Array<{ id: string; product_name: string; caliber: string | null; pallet_count: number | null; pallet_weight: number | null; invoice_price: number | null; indicative_price: number | null; qty: number }>;
    distributions: Array<{ id: string; branch_id: string; status: string; branches: { name: string | null; sort_order: number | null } | null; distribution_items: Array<{ pallets: number | null; qty: number | null; shipment_item_id: string }> | null }>;
    requests: Array<{ id: string; status: string; request_type: string | null; qty: number | null; approved_qty: number | null; notes: string | null; branch_id: string; created_at: string }>;
    changes: Array<{ id: string; field: string; old_value: string | null; new_value: string | null; created_at: string }>;
  };
}

type Item = {
  id: string;
  product_name: string;
  caliber: string | null;
  pallet_count: number | null;
  pallet_weight: number | null;
  invoice_price: number | null;
  indicative_price: number | null;
  qty: number;
};

function ShipmentItemRow({ item, shipmentId }: { item: Item; shipmentId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    product_name: item.product_name,
    caliber: item.caliber ?? "",
    pallet_count: item.pallet_count ?? 0,
    pallet_weight: item.pallet_weight ?? 0,
    invoice_price: item.invoice_price ?? 0,
    indicative_price: item.indicative_price ?? 0,
  });
  const totalKg = Number(form.pallet_count) * Number(form.pallet_weight);
  const save = async () => {
    const { error } = await supabase.from("shipment_items").update({
      product_name: form.product_name, caliber: form.caliber || null,
      pallet_count: Number(form.pallet_count), pallet_weight: Number(form.pallet_weight),
      invoice_price: Number(form.invoice_price), indicative_price: Number(form.indicative_price),
      qty: totalKg, unit_price: Number(form.invoice_price),
    }).eq("id", item.id);
    if (error) return toast.error(error.message);
    toast.success("Збережено");
    qc.invalidateQueries({ queryKey: ["shipment", shipmentId] });
    setOpen(false);
  };
  const remove = async () => {
    const { error } = await supabase.from("shipment_items").delete().eq("id", item.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["shipment", shipmentId] });
  };

  return (
    <div className="rounded-xl border border-border bg-background/50 p-3">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between text-left">
        <div>
          <div className="text-sm font-semibold">{item.product_name}</div>
          <div className="text-xs text-muted-foreground">
            {item.caliber ? `Калібр ${item.caliber} · ` : ""}
            {Number(item.pallet_count ?? 0)} пал. × {Number(item.pallet_weight ?? 0)} кг
          </div>
        </div>
        <span className="text-xs font-medium text-brand">{open ? "Згорнути" : "Редагувати"}</span>
      </button>
      {open && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">Назва товару</Label>
            <Input value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })} />
          </div>
          <div className="space-y-1"><Label className="text-xs">Калібр</Label>
            <Input value={form.caliber} onChange={(e) => setForm({ ...form, caliber: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">Палет</Label>
            <Input type="number" value={form.pallet_count} onChange={(e) => setForm({ ...form, pallet_count: Number(e.target.value) })} /></div>
          <div className="space-y-1"><Label className="text-xs">Вага палети, кг</Label>
            <Input type="number" value={form.pallet_weight} onChange={(e) => setForm({ ...form, pallet_weight: Number(e.target.value) })} /></div>
          <div className="space-y-1"><Label className="text-xs">Інвойсна ціна</Label>
            <Input type="number" step="0.01" value={form.invoice_price} onChange={(e) => setForm({ ...form, invoice_price: Number(e.target.value) })} /></div>
          <div className="space-y-1"><Label className="text-xs">Орієнтовна ціна</Label>
            <Input type="number" step="0.01" value={form.indicative_price} onChange={(e) => setForm({ ...form, indicative_price: Number(e.target.value) })} /></div>
          <div className="col-span-2 flex items-center justify-between pt-1">
            <span className="text-xs text-muted-foreground">Загальна вага: {totalKg} кг</span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={remove} className="text-destructive">Видалити</Button>
              <Button size="sm" onClick={save} className="bg-brand text-brand-foreground hover:bg-brand/90">Зберегти</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, StatCard, EmptyState } from "@/components/cards";
import { StatusChip } from "@/components/StatusChip";
import { CostPair } from "@/components/CostPair";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { COUNTRY_DAYS, calcArrivalDate, toDateInputValue } from "@/lib/arrival";
import { toUaCountry } from "@/lib/countries";
import { allocateTransport, fmtKg, fmtPct } from "@/lib/transport";
import { CURRENCIES, type Currency, fmtUSD, fmtRate, convertToUsd } from "@/lib/currency";
import { useAuth } from "@/lib/auth";
import { Lock } from "lucide-react";

import { StaffOnly } from "@/components/StaffOnly";
import { useFocusHighlight } from "@/lib/use-focus-highlight";

const VEHICLE_MAX_PALLETS = 26;
const VEHICLE_MAX_KG = 21500;

export const Route = createFileRoute("/_authenticated/shipments/$id")({
  component: () => <StaffOnly><ShipmentDetail /></StaffOnly>,
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
        subtitle={sh.suppliers?.name ?? toUaCountry(sh.country) ?? ""}
        action={<StatusChip status={sh.status} />}
      />

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Факт палет" value={fact} tone="primary" />
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

      {tab === "products" && <ProductsTab items={data!.items} shipmentId={id} shipment={sh} />}
      {tab === "distribution" && <DistributionTab distributions={data!.distributions} shipmentId={id} />}
      {tab === "requests" && <RequestsTab requests={data!.requests} qc={qc} />}
      {tab === "history" && <HistoryTab changes={data!.changes} />}
      {tab === "logistics" && <LogisticsTab shipment={sh} shipmentId={id} qc={qc} items={data!.items} />}
      <Outlet />
    </div>
  );
}

type ShipmentRow = {
  status: string;
  eta: string | null;
  loading_date: string | null;
  logistics_days: number | null;
  country: string | null;
  logistics_cost: number | null;
  logistics_cost_usd: number | null;
  logistics_cost_currency: string | null;
  eur_usd_rate: number | null;
  eur_usd_rate_date: string | null;
  vehicle_id: string | null;
};

function ProductsTab({ items, shipmentId, shipment }: { items: Item[]; shipmentId: string; shipment: ShipmentRow }) {
  const fallbackCountry = toUaCountry(shipment.country) || "—";
  const fmt = (v: number) => (Number(v) || 0).toFixed(2);
  useFocusHighlight([items]);
  return (
    <SectionCard
      title="Товари"
      action={
        <div className="flex gap-2">
          <Link to="/shipments/$id/products" params={{ id: shipmentId }}>
            <Button size="sm" className="bg-brand text-brand-foreground hover:bg-brand/90">Відкрити</Button>
          </Link>
          <Link to="/distribution/$shipmentId" params={{ shipmentId }}>
            <Button size="sm" variant="secondary">Розподіл</Button>
          </Link>
        </div>
      }
    >
      {!items.length ? (
        <Link to="/shipments/$id/products" params={{ id: shipmentId }} className="block">
          <EmptyState title="Позицій ще немає — натисніть, щоб додати" />
        </Link>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[640px] text-[11px] tabular-nums">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                <th className="py-1.5 px-1 text-left font-medium">Товар</th>
                <th className="py-1.5 px-1 text-left font-medium">Сорт</th>
                <th className="py-1.5 px-1 text-left font-medium">Країна</th>
                <th className="py-1.5 px-1 text-left font-medium">Калібр</th>
                <th className="py-1.5 px-1 text-left font-medium">Спец.</th>
                <th className="py-1.5 px-1 text-right font-medium">Пал.</th>
                <th className="py-1.5 px-1 text-right font-medium">Собів. $</th>
              </tr>
            </thead>
            <tbody>
              {items.filter((it) => (it.product_name || "").trim() !== "" || Number(it.pallet_count ?? 0) > 0).map((it) => (
                <tr key={it.id} data-focus-id={`item:${it.id}`} className="border-b border-border/40">
                  <td className="py-1.5 px-1 font-medium">{it.product_name || "—"}</td>
                  <td className="py-1.5 px-1 text-muted-foreground">{it.variety || "—"}</td>
                  <td className="py-1.5 px-1 text-muted-foreground">{it.origin_country || fallbackCountry}</td>
                  <td className="py-1.5 px-1">{it.caliber || "—"}</td>
                  <td className="py-1.5 px-1 text-muted-foreground">{it.sku || "—"}</td>
                  <td className="py-1.5 px-1 text-right">{Number(it.pallet_count ?? 0)}</td>
                  <td className="py-1.5 px-1 text-right"><CostPair indicative={it.final_cost_indicative} invoice={it.final_cost_invoice} /></td>
                </tr>
              ))}
            </tbody>
          </table>
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

function LogisticsTab({ shipment, shipmentId, qc, items }: { shipment: ShipmentRow; shipmentId: string; qc: ReturnType<typeof useQueryClient>; items: Item[] }) {
  const { user, hasRole } = useAuth();
  const isAdmin = hasRole(["super_admin", "admin"]);
  const [eta, setEta] = useState<string>("");
  const etaLocked = DISTRIBUTION_LOCKED_STATUSES.has(shipment.status);
  const currentEta = eta || shipment.eta || "";

  const recompute = () => {
    if (!shipment.loading_date) return;
    const days = shipment.logistics_days ?? (shipment.country ? COUNTRY_DAYS[toUaCountry(shipment.country)] ?? 0 : 0);
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

  // Vehicle-wide transport: load vehicle, sibling shipments & their items
  const { data: vehicleData } = useQuery({
    queryKey: ["vehicle-transport", shipment.vehicle_id, shipmentId],
    enabled: !!shipment.vehicle_id,
    queryFn: async () => {
      const [{ data: veh }, { data: sibs }] = await Promise.all([
        supabase
          .from("vehicles" as never)
          .select("id,created_by,total_pallets,total_weight_kg,country,code")
          .eq("id", shipment.vehicle_id!)
          .single(),
        supabase
          .from("shipments")
          .select("id,code,logistics_cost,logistics_cost_currency,logistics_cost_usd,eur_usd_rate,created_by,import_manager_id,created_at")
          .eq("vehicle_id", shipment.vehicle_id!)
          .order("created_at", { ascending: true }),
      ]);
      const sibIds = (sibs ?? []).map((s) => s.id);
      const { data: sibItems } = sibIds.length
        ? await supabase
            .from("shipment_items")
            .select("id,shipment_id,pallet_count,pallet_weight,product_name")
            .in("shipment_id", sibIds)
        : { data: [] as { id: string; shipment_id: string; pallet_count: number | null; pallet_weight: number | null; product_name: string | null }[] };
      return { vehicle: veh as { id: string; created_by: string | null; total_pallets: number | null; total_weight_kg: number | null; country: string | null; code: string | null } | null, siblings: sibs ?? [], allItems: sibItems ?? [] };
    },
  });

  const vehicle = vehicleData?.vehicle ?? null;
  const siblings = vehicleData?.siblings ?? [];
  const sharedVehicle = !!vehicle && (siblings.length > 1 || (vehicle.created_by && vehicle.created_by !== user?.id));
  const isVehicleOwner = !!vehicle && (!vehicle.created_by || vehicle.created_by === user?.id || isAdmin);
  // Find the sibling whose owner is the vehicle creator (the one who pays transport)
  const ownerShipment = siblings.find((s) => s.created_by === vehicle?.created_by) ?? siblings.find((s) => Number(s.logistics_cost ?? 0) > 0);
  const otherWithCost = siblings.find((s) => s.id !== shipmentId && Number(s.logistics_cost ?? 0) > 0);
  const transportLocked = !isVehicleOwner || !!otherWithCost;
  const inheritedCurrency = (ownerShipment?.logistics_cost_currency as Currency) ?? (otherWithCost?.logistics_cost_currency as Currency) ?? "EUR";
  const inheritedAmount = Number(ownerShipment?.logistics_cost ?? otherWithCost?.logistics_cost ?? 0);
  const inheritedUsd = Number(ownerShipment?.logistics_cost_usd ?? otherWithCost?.logistics_cost_usd ?? convertToUsd(inheritedAmount, inheritedCurrency, ownerShipment?.eur_usd_rate ?? otherWithCost?.eur_usd_rate));

  const savedCurrency = (shipment.logistics_cost_currency as Currency) ?? "EUR";
  const [transportCurrency, setTransportCurrency] = useState<Currency>(savedCurrency);
  const [transport, setTransport] = useState<string>("");
  const totalTransport = transport === "" ? Number(shipment.logistics_cost ?? 0) : Number(transport.replace(",", "."));
  const totalTransportUsd = convertToUsd(totalTransport, transportCurrency, shipment.eur_usd_rate);

  // Vehicle capacity / free space
  const loadedP = Number(vehicle?.total_pallets ?? 0);
  const loadedKg = Number(vehicle?.total_weight_kg ?? 0);
  const freeP = Math.max(0, VEHICLE_MAX_PALLETS - loadedP);
  const freeKg = Math.max(0, VEHICLE_MAX_KG - loadedKg);

  // Vehicle-wide totals for display & allocation
  const vehicleTotalUsd = siblings.length
    ? siblings.reduce((a, s) => {
        if (s.id === shipmentId && transport !== "" && !transportLocked) return a + totalTransportUsd;
        return a + Number(s.logistics_cost_usd ?? 0);
      }, 0)
    : totalTransportUsd;
  const allocItems = (vehicleData?.allItems ?? []).length ? vehicleData!.allItems : items;
  const alloc = allocateTransport(allocItems, vehicleTotalUsd);

  const saveTransport = async () => {
    if (transportLocked) return;
    const { error } = await supabase.from("shipments").update({
      logistics_cost: totalTransport,
      logistics_cost_currency: transportCurrency,
    }).eq("id", shipmentId);
    if (error) return toast.error(error.message);
    toast.success("Транспортні витрати збережено");
    setTransport("");
    qc.invalidateQueries({ queryKey: ["shipment", shipmentId] });
    qc.invalidateQueries({ queryKey: ["vehicle-transport", shipment.vehicle_id, shipmentId] });
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
            Завантаження: {shipment.loading_date ?? "—"} · Країна: {toUaCountry(shipment.country) || "—"}
          </p>
        </div>
      </SectionCard>

      {sharedVehicle && vehicle && (
        <SectionCard title={`Авто ${vehicle.code ?? ""} — спільне завантаження`}>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <StatCard label="Завантажено" value={`${loadedP} пал · ${Math.round(loadedKg)} кг`} />
              <StatCard
                label="Вільно"
                value={`${freeP} пал · ${Math.round(freeKg)} кг`}
                tone={freeP <= 1 ? "primary" : "brand"}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Місткість авто: {VEHICLE_MAX_PALLETS} пал · {VEHICLE_MAX_KG} кг.
              {!isVehicleOwner && (
                <> Країна та маршрут зафіксовані власником авто — змінити не можна.</>
              )}
            </p>
            {siblings.length > 1 && (
              <ul className="divide-y divide-border rounded-md border border-border bg-secondary/30 text-xs">
                {siblings.map((s) => {
                  const mine = s.id === shipmentId;
                  const owner = s.created_by === vehicle.created_by;
                  return (
                    <li key={s.id} className="flex items-center justify-between px-3 py-1.5">
                      <span className={cn("font-medium", mine && "text-brand")}>
                        {s.code} {mine && "(ваш)"}
                      </span>
                      <span className="text-muted-foreground">
                        {owner ? "власник авто" : "со-завантажувач"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </SectionCard>
      )}

      <SectionCard title="Транспортні витрати — розподіл по товарах">
        <div className="space-y-3">
          {transportLocked ? (
            <div className="rounded-xl border border-dashed border-brand/40 bg-brand/5 p-3 text-sm">
              <div className="flex items-center gap-1 text-xs uppercase tracking-wider text-muted-foreground">
                <Lock className="h-3 w-3" /> {isVehicleOwner ? "Транспорт вже вказано для авто" : "Транспорт оплачує власник авто (тільки перегляд)"}
              </div>
              <div className="mt-1 text-base font-semibold text-foreground">
                {inheritedAmount > 0 ? (
                  <>
                    {inheritedAmount.toFixed(2)} {inheritedCurrency}
                    {inheritedCurrency === "EUR" && <span className="ml-2 text-muted-foreground">≈ {fmtUSD(inheritedUsd)}</span>}
                  </>
                ) : (
                  <span className="text-muted-foreground">Очікується від власника авто</span>
                )}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Вартість транспорту вводиться один раз на авто і автоматично розподіляється між позиціями всіх постачальників пропорційно вазі.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <Label htmlFor="transport" className="text-xs">Загальна вартість транспорту (на все авто)</Label>
              <div className="flex gap-2">
                <Input id="transport" type="text" inputMode="decimal" className="flex-1"
                  placeholder="—"
                  value={transport === "" ? (Number(shipment.logistics_cost ?? 0) === 0 ? "" : String(shipment.logistics_cost)) : transport}
                  onChange={(e) => setTransport(e.target.value.replace(/[^\d.,-]/g, ""))} />
                <select
                  value={transportCurrency}
                  onChange={(e) => setTransportCurrency(e.target.value as Currency)}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <Button type="button" onClick={saveTransport} className="bg-brand text-brand-foreground hover:bg-brand/90">Зберегти</Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {transportCurrency === "EUR"
                  ? <>Курс EUR/USD: <b>{fmtRate(shipment.eur_usd_rate)}</b>{shipment.eur_usd_rate_date ? ` (${shipment.eur_usd_rate_date})` : ""} · конверт.: <b className="text-foreground">{fmtUSD(totalTransportUsd)}</b></>
                  : <>Базова валюта обліку — USD</>}
                {" "}· Розподіл пропорційно до фактичної ваги по всьому авто.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <StatCard label="Загальна вага (авто)" value={fmtKg(alloc.shipmentTotalWeight)} />
            <StatCard label="Транспорт всього (авто)" value={fmtUSD(vehicleTotalUsd)} tone="brand" />
          </div>

          {!alloc.shipmentTotalWeight ? <EmptyState title="Додайте позиції щоб побачити розподіл" /> : (
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[520px] text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="py-2 text-left font-medium">Товар</th>
                    <th className="py-2 text-right font-medium">Вага</th>
                    <th className="py-2 text-right font-medium">Частка</th>
                    <th className="py-2 text-right font-medium">Транспорт</th>
                    <th className="py-2 text-right font-medium">$/кг</th>
                  </tr>
                </thead>
                <tbody>
                  {allocItems.map((it) => {
                    const r = alloc.rows[it.id];
                    if (!r) return null;
                    return (
                      <tr key={it.id} data-focus-id={`item:${it.id}`} className="border-b border-border/50">
                        <td className="py-2 pr-2 font-medium">{it.product_name}</td>
                        <td className="py-2 text-right tabular-nums">{fmtKg(r.productTotalWeight)}</td>
                        <td className="py-2 text-right tabular-nums">{fmtPct(r.weightShare)}</td>
                        <td className="py-2 text-right tabular-nums">{fmtUSD(r.allocatedTransportCost)}</td>
                        <td className="py-2 text-right tabular-nums text-brand">{fmtUSD(r.transportCostPerKg)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
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

type Item = {
  id: string;
  product_name: string;
  variety: string | null;
  origin_country: string | null;
  caliber: string | null;
  sku: string | null;
  pallet_count: number | null;
  pallet_weight: number | null;
  invoice_price: number | null;
  indicative_price: number | null;
  cost_price_usd: number | null;
  qty: number;
  unit_price: number | null;
  unit_price_usd: number | null;
  price_currency: string | null;
  fx_rate_used: number | null;
  customs_match_id: string | null;
  customs_cost_indicative: number | null;
  customs_cost_invoice: number | null;
  final_cost_indicative: number | null;
  final_cost_invoice: number | null;
};

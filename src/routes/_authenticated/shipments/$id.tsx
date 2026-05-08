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
import { COUNTRY_DAYS, calcArrivalDate, toDateInputValue } from "@/lib/arrival";

export const Route = createFileRoute("/_authenticated/shipments/$id")({
  component: ShipmentDetail,
});

const DISTRIBUTION_LOCKED_STATUSES = new Set(["distributing", "completed"]);

function ShipmentDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["shipment", id],
    queryFn: async () => {
      const [s, items] = await Promise.all([
        supabase.from("shipments").select("*, suppliers(name,country)").eq("id", id).single(),
        supabase.from("shipment_items").select("*").eq("shipment_id", id).order("created_at"),
      ]);
      return { shipment: s.data, items: items.data ?? [] };
    },
  });

  const sh = data?.shipment;
  const [eta, setEta] = useState<string>("");
  const [savingEta, setSavingEta] = useState(false);

  if (!sh) return <p className="text-sm text-muted-foreground">Завантаження…</p>;

  const etaLocked = DISTRIBUTION_LOCKED_STATUSES.has(sh.status);
  const currentEta = eta || sh.eta || "";

  const recompute = () => {
    if (!sh.loading_date) return;
    const days = sh.logistics_days ?? (sh.country ? COUNTRY_DAYS[sh.country] ?? 0 : 0);
    const next = toDateInputValue(calcArrivalDate(sh.loading_date, days));
    setEta(next);
  };

  const saveEta = async () => {
    setSavingEta(true);
    try {
      const { error } = await supabase.from("shipments").update({ eta: currentEta || null }).eq("id", id);
      if (error) throw error;
      toast.success("Дату прибуття оновлено");
      qc.invalidateQueries({ queryKey: ["shipment", id] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Помилка");
    } finally {
      setSavingEta(false);
    }
  };

  const addItem = async () => {
    const { error } = await supabase.from("shipment_items").insert({
      shipment_id: id,
      product_name: "Новий товар",
      qty: 0,
      unit: "kg",
      unit_price: 0,
      pallet_count: 0,
      pallet_weight: 0,
      invoice_price: 0,
      indicative_price: 0,
    });
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["shipment", id] });
  };

  return (
    <div className="space-y-4">
      <PageHeader title={sh.code} subtitle={sh.suppliers?.name ?? sh.country ?? ""} action={<StatusChip status={sh.status} />} />

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Країна" value={sh.country ?? "—"} />
        <StatCard label="Днів логістики" value={sh.logistics_days ?? "—"} />
        <StatCard label="Дата завантаження" value={sh.loading_date ? new Date(sh.loading_date).toLocaleDateString("uk-UA") : "—"} />
        <StatCard label="Позицій" value={data!.items.length} tone="primary" />
      </div>

      <SectionCard title="Дата прибуття">
        <div className="space-y-2">
          <Label htmlFor="eta">{etaLocked ? "Розподіл розпочато — редагування заблоковано" : "Можна редагувати до старту розподілу"}</Label>
          <div className="flex gap-2">
            <Input
              id="eta"
              type="date"
              value={currentEta}
              onChange={(e) => setEta(e.target.value)}
              disabled={etaLocked}
            />
            <Button type="button" variant="secondary" onClick={recompute} disabled={etaLocked}>Перерахувати</Button>
            <Button type="button" onClick={saveEta} disabled={etaLocked || savingEta} className="bg-brand text-brand-foreground hover:bg-brand/90">
              Зберегти
            </Button>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Позиції"
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={addItem}>+ Позиція</Button>
            <Link to="/distribution/$shipmentId" params={{ shipmentId: id }}>
              <Button size="sm" className="bg-brand text-brand-foreground hover:bg-brand/90">Розподіл</Button>
            </Link>
          </div>
        }
      >
        {!data!.items.length ? (
          <EmptyState title="Позицій ще немає" hint="Додайте товари до поставки" />
        ) : (
          <div className="space-y-2">
            {data!.items.map((it) => (
              <ShipmentItemRow key={it.id} item={it} shipmentId={id} />
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
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
      product_name: form.product_name,
      caliber: form.caliber || null,
      pallet_count: Number(form.pallet_count),
      pallet_weight: Number(form.pallet_weight),
      invoice_price: Number(form.invoice_price),
      indicative_price: Number(form.indicative_price),
      qty: totalKg,
      unit_price: Number(form.invoice_price),
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
          <div className="space-y-1">
            <Label className="text-xs">Калібр</Label>
            <Input value={form.caliber} onChange={(e) => setForm({ ...form, caliber: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Палет</Label>
            <Input type="number" value={form.pallet_count} onChange={(e) => setForm({ ...form, pallet_count: Number(e.target.value) })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Вага палети, кг</Label>
            <Input type="number" value={form.pallet_weight} onChange={(e) => setForm({ ...form, pallet_weight: Number(e.target.value) })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Інвойсна ціна</Label>
            <Input type="number" step="0.01" value={form.invoice_price} onChange={(e) => setForm({ ...form, invoice_price: Number(e.target.value) })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Орієнтовна ціна</Label>
            <Input type="number" step="0.01" value={form.indicative_price} onChange={(e) => setForm({ ...form, indicative_price: Number(e.target.value) })} />
          </div>
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

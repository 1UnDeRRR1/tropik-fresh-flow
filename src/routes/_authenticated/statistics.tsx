import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { useAuth } from "@/lib/auth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/statistics")({
  component: StatisticsPage,
});

type ItemRow = {
  id: string;
  shipment_id: string;
  product_name: string;
  origin_country: string | null;
  pallet_count: number | null;
  unit_price: number | null;
  price_currency: string | null;
  final_cost_indicative: number | null;
  final_cost_invoice: number | null;
};

type ShipmentRow = {
  id: string;
  country: string | null;
  loading_date: string | null;
  eta: string | null;
  arrived_at: string | null;
  created_at: string;
  supplier_id: string | null;
};

type Supplier = { id: string; name: string };

function pad(n: number) { return n < 10 ? `0${n}` : `${n}`; }
function toISO(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function parseISO(s: string) { const [y,m,d] = s.split("-").map(Number); return new Date(y, m-1, d); }
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate()+n); return r; }

// ISO week number
function isoWeek(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((t.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { year: t.getUTCFullYear(), week };
}
function weekRange(year: number, week: number): [Date, Date] {
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const dow = simple.getUTCDay() || 7;
  const monday = new Date(simple);
  monday.setUTCDate(simple.getUTCDate() - (dow - 1));
  const start = new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate());
  return [start, addDays(start, 6)];
}

const UK_MONTHS = ["Січень","Лютий","Березень","Квітень","Травень","Червень","Липень","Серпень","Вересень","Жовтень","Листопад","Грудень"];

type PeriodMode = "week" | "month" | "year" | "custom";

function StatisticsPage() {
  const { hasRole, loading } = useAuth();
  if (loading) return null;
  if (!hasRole(["admin", "super_admin"])) return <Navigate to="/" />;

  // 12 months window
  const today = new Date();
  const minDate = addDays(today, -365);

  const [mode, setMode] = useState<PeriodMode>("month");
  const [monthVal, setMonthVal] = useState<string>(() => `${today.getFullYear()}-${pad(today.getMonth()+1)}`);
  const [weekVal, setWeekVal] = useState<string>(() => {
    const w = isoWeek(today); return `${w.year}-W${pad(w.week)}`;
  });
  const [yearVal, setYearVal] = useState<string>(() => `${today.getFullYear()}`);
  const [fromVal, setFromVal] = useState<string>(toISO(minDate));
  const [toVal, setToVal] = useState<string>(toISO(today));

  const [from, to] = useMemo<[Date, Date]>(() => {
    if (mode === "month") {
      const [y, m] = monthVal.split("-").map(Number);
      const start = new Date(y, m - 1, 1);
      const end = new Date(y, m, 0);
      return [start, end];
    }
    if (mode === "week") {
      const [y, w] = weekVal.split("-W").map(Number);
      return weekRange(y, w);
    }
    if (mode === "year") {
      const y = Number(yearVal);
      return [new Date(y, 0, 1), new Date(y, 11, 31)];
    }
    return [parseISO(fromVal), parseISO(toVal)];
  }, [mode, monthVal, weekVal, yearVal, fromVal, toVal]);

  const fromISOStr = toISO(from);
  const toISOStr = toISO(to);

  const { data, isLoading } = useQuery({
    queryKey: ["statistics-12m"],
    queryFn: async () => {
      const cutoff = toISO(minDate);
      const [shRes, supRes] = await Promise.all([
        supabase
          .from("shipments")
          .select("id,country,loading_date,eta,arrived_at,created_at,supplier_id, shipment_items(id,shipment_id,product_name,origin_country,pallet_count,unit_price,price_currency,final_cost_indicative,final_cost_invoice)")
          .gte("created_at", `${cutoff}T00:00:00`)
          .order("loading_date", { ascending: false })
          .limit(2000),
        supabase.from("suppliers").select("id,name").order("name"),
      ]);
      const shipments = ((shRes.data ?? []) as unknown as (ShipmentRow & { shipment_items: ItemRow[] })[]);
      const suppliers = (supRes.data ?? []) as Supplier[];
      return { shipments, suppliers };
    },
  });

  const shipments = data?.shipments ?? [];
  const suppliers = data?.suppliers ?? [];
  const supplierMap = useMemo(() => Object.fromEntries(suppliers.map(s => [s.id, s.name])), [suppliers]);

  // Flatten + filter by date range using best-available date
  type Flat = {
    item: ItemRow;
    shipment: ShipmentRow;
    date: string; // ISO
  };
  const flat = useMemo<Flat[]>(() => {
    const out: Flat[] = [];
    for (const sh of shipments) {
      const dateStr = sh.loading_date ?? sh.arrived_at ?? sh.eta ?? sh.created_at.slice(0, 10);
      if (!dateStr) continue;
      if (dateStr < fromISOStr || dateStr > toISOStr) continue;
      for (const it of (sh.shipment_items ?? [])) {
        if (!it.product_name?.trim()) continue;
        if (!it.pallet_count || Number(it.pallet_count) <= 0) continue;
        out.push({ item: it, shipment: sh, date: dateStr });
      }
    }
    return out;
  }, [shipments, fromISOStr, toISOStr]);

  // Product/country pairs
  const productOptions = useMemo(() => {
    const set = new Map<string, { product: string; country: string }>();
    for (const f of flat) {
      const country = f.item.origin_country ?? f.shipment.country ?? "—";
      const key = `${f.item.product_name}||${country}`;
      if (!set.has(key)) set.set(key, { product: f.item.product_name, country });
    }
    return Array.from(set.entries()).map(([key, v]) => ({ key, ...v })).sort((a,b) => a.product.localeCompare(b.product, "uk"));
  }, [flat]);

  const supplierOptions = useMemo(() => {
    const ids = new Set(flat.map(f => f.shipment.supplier_id).filter(Boolean) as string[]);
    return suppliers.filter(s => ids.has(s.id));
  }, [flat, suppliers]);

  const [selectedProductKey, setSelectedProductKey] = useState<string>("");
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");

  const productRows = useMemo(() => {
    if (!selectedProductKey) return [];
    const [product, country] = selectedProductKey.split("||");
    return flat
      .filter(f => f.item.product_name === product && (f.item.origin_country ?? f.shipment.country ?? "—") === country)
      .sort((a,b) => a.date.localeCompare(b.date));
  }, [flat, selectedProductKey]);

  const supplierRows = useMemo(() => {
    if (!selectedSupplierId) return [];
    return flat
      .filter(f => f.shipment.supplier_id === selectedSupplierId)
      .sort((a,b) => a.date.localeCompare(b.date));
  }, [flat, selectedSupplierId]);

  const supplierStats = useMemo(() => {
    if (supplierRows.length === 0) return null;
    let totalPallets = 0;
    let priceSum = 0, priceCnt = 0;
    let invSum = 0, invCnt = 0;
    for (const r of supplierRows) {
      const p = Number(r.item.pallet_count ?? 0);
      totalPallets += p;
      if (r.item.unit_price) { priceSum += Number(r.item.unit_price); priceCnt++; }
      if (r.item.final_cost_invoice) { invSum += Number(r.item.final_cost_invoice); invCnt++; }
    }
    return {
      totalPallets,
      avgPrice: priceCnt ? priceSum / priceCnt : 0,
      avgInvoice: invCnt ? invSum / invCnt : 0,
    };
  }, [supplierRows]);

  // Build month/week options within last 12 months
  const monthOptions = useMemo(() => {
    const arr: { value: string; label: string }[] = [];
    const d = new Date(today.getFullYear(), today.getMonth(), 1);
    for (let i = 0; i < 12; i++) {
      const dd = new Date(d.getFullYear(), d.getMonth() - i, 1);
      const value = `${dd.getFullYear()}-${pad(dd.getMonth()+1)}`;
      arr.push({ value, label: `${UK_MONTHS[dd.getMonth()]} ${dd.getFullYear()}` });
    }
    return arr;
  }, []);

  const weekOptions = useMemo(() => {
    const arr: { value: string; label: string }[] = [];
    let d = new Date(today);
    for (let i = 0; i < 53; i++) {
      const w = isoWeek(d);
      const [s, e] = weekRange(w.year, w.week);
      if (e < minDate) break;
      const value = `${w.year}-W${pad(w.week)}`;
      const label = `Тиждень ${w.week} (${pad(s.getDate())}.${pad(s.getMonth()+1)} – ${pad(e.getDate())}.${pad(e.getMonth()+1)} ${w.year})`;
      if (!arr.find(x => x.value === value)) arr.push({ value, label });
      d = addDays(d, -7);
    }
    return arr;
  }, []);

  const yearOptions = useMemo(() => {
    const y = today.getFullYear();
    return [{ value: `${y}`, label: `${y}` }, { value: `${y-1}`, label: `${y-1}` }];
  }, []);

  const fmtDate = (s: string) => {
    const d = parseISO(s);
    return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${String(d.getFullYear()).slice(2)}`;
  };
  const fmtNum = (n: number | null | undefined, digits = 2) => n == null ? "—" : Number(n).toFixed(digits);

  return (
    <div className="space-y-4">
      <PageHeader title="Статистика" subtitle="Останні 12 місяців" />

      {/* PERIOD */}
      <SectionCard title="Період">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {(["week","month","year","custom"] as PeriodMode[]).map(m => (
              <Button
                key={m}
                size="sm"
                variant={mode === m ? "default" : "outline"}
                onClick={() => setMode(m)}
              >
                {m === "week" ? "Тиждень" : m === "month" ? "Місяць" : m === "year" ? "Рік" : "Період"}
              </Button>
            ))}
          </div>
          {mode === "month" && (
            <Select value={monthVal} onValueChange={setMonthVal}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {monthOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {mode === "week" && (
            <Select value={weekVal} onValueChange={setWeekVal}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {weekOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {mode === "year" && (
            <Select value={yearVal} onValueChange={setYearVal}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {yearOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {mode === "custom" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Від</label>
                <Input type="date" min={toISO(minDate)} max={toISO(today)} value={fromVal} onChange={(e) => setFromVal(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">До</label>
                <Input type="date" min={toISO(minDate)} max={toISO(today)} value={toVal} onChange={(e) => setToVal(e.target.value)} />
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {fmtDate(fromISOStr)} – {fmtDate(toISOStr)} • позицій: {flat.length}
          </p>
        </div>
      </SectionCard>

      {/* PRODUCTS */}
      <SectionCard title="Товари">
        <div className="space-y-3">
          <Select value={selectedProductKey} onValueChange={setSelectedProductKey}>
            <SelectTrigger><SelectValue placeholder="Оберіть товар • країна" /></SelectTrigger>
            <SelectContent>
              {productOptions.length === 0 && <div className="px-2 py-1 text-xs text-muted-foreground">Немає даних</div>}
              {productOptions.map(o => (
                <SelectItem key={o.key} value={o.key}>{o.product} • {o.country}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isLoading ? (
            <EmptyState title="Завантаження…" />
          ) : !selectedProductKey ? (
            <EmptyState title="Оберіть товар" hint="Покажемо всі закупки за період" />
          ) : productRows.length === 0 ? (
            <EmptyState title="Немає закупок" hint="За обраний період" />
          ) : (
            <div className="-mx-4 overflow-x-auto px-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата</TableHead>
                    <TableHead>Постачальник</TableHead>
                    <TableHead className="text-right">Палет</TableHead>
                    <TableHead className="text-right">Закупка</TableHead>
                    <TableHead className="text-right">Індикатив</TableHead>
                    <TableHead className="text-right">Інвойс</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {productRows.map(r => (
                    <TableRow key={r.item.id}>
                      <TableCell className="whitespace-nowrap">{fmtDate(r.date)}</TableCell>
                      <TableCell className="whitespace-nowrap">{supplierMap[r.shipment.supplier_id ?? ""] ?? "—"}</TableCell>
                      <TableCell className="text-right">{fmtNum(r.item.pallet_count, 0)}</TableCell>
                      <TableCell className="text-right">{fmtNum(r.item.unit_price)}</TableCell>
                      <TableCell className="text-right">{fmtNum(r.item.final_cost_indicative)}</TableCell>
                      <TableCell className="text-right">{fmtNum(r.item.final_cost_invoice)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </SectionCard>

      {/* SUPPLIERS */}
      <SectionCard title="Постачальники">
        <div className="space-y-3">
          <Select value={selectedSupplierId} onValueChange={setSelectedSupplierId}>
            <SelectTrigger><SelectValue placeholder="Оберіть постачальника" /></SelectTrigger>
            <SelectContent>
              {supplierOptions.length === 0 && <div className="px-2 py-1 text-xs text-muted-foreground">Немає даних</div>}
              {supplierOptions.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {isLoading ? (
            <EmptyState title="Завантаження…" />
          ) : !selectedSupplierId ? (
            <EmptyState title="Оберіть постачальника" />
          ) : supplierRows.length === 0 ? (
            <EmptyState title="Немає закупок" hint="За обраний період" />
          ) : (
            <>
              {supplierStats && (
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border border-border bg-card p-2">
                    <div className="text-[10px] uppercase text-muted-foreground">Палет</div>
                    <div className="text-lg font-bold">{supplierStats.totalPallets}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-card p-2">
                    <div className="text-[10px] uppercase text-muted-foreground">сер. закупка</div>
                    <div className="text-lg font-bold">{supplierStats.avgPrice.toFixed(2)}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-card p-2">
                    <div className="text-[10px] uppercase text-muted-foreground">сер. інвойс</div>
                    <div className="text-lg font-bold">{supplierStats.avgInvoice.toFixed(2)}</div>
                  </div>
                </div>
              )}
              <div className="-mx-4 overflow-x-auto px-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Товар</TableHead>
                      <TableHead>Країна</TableHead>
                      <TableHead className="text-right">Палет</TableHead>
                      <TableHead className="text-right">Закупка</TableHead>
                      <TableHead className="text-right">Індикатив</TableHead>
                      <TableHead className="text-right">Інвойс</TableHead>
                      <TableHead>Дата</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {supplierRows.map(r => (
                      <TableRow key={r.item.id}>
                        <TableCell className="whitespace-nowrap">{r.item.product_name}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.item.origin_country ?? r.shipment.country ?? "—"}</TableCell>
                        <TableCell className="text-right">{fmtNum(r.item.pallet_count, 0)}</TableCell>
                        <TableCell className="text-right">{fmtNum(r.item.unit_price)}</TableCell>
                        <TableCell className="text-right">{fmtNum(r.item.final_cost_indicative)}</TableCell>
                        <TableCell className="text-right">{fmtNum(r.item.final_cost_invoice)}</TableCell>
                        <TableCell className="whitespace-nowrap">{fmtDate(r.date)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>
      </SectionCard>
    </div>
  );
}

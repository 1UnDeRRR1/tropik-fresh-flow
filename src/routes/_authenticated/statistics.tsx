import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { useAuth } from "@/lib/auth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { CompactFilterSelect } from "@/components/CompactFilterSelect";
import { Button } from "@/components/ui/button";
import { canonicalizeProductName } from "@/lib/product-aliases";
import { useCountryAliases } from "@/hooks/useCountryAliases";
import { useProductAliases } from "@/hooks/useProductAliases";

export const Route = createFileRoute("/_authenticated/statistics")({
  component: StatisticsPage,
});

const ALL = "__all__";

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
  import_manager_id: string | null;
};

type Supplier = { id: string; name: string };
type Manager = { id: string; user_id: string | null; full_name: string };

function pad(n: number) { return n < 10 ? `0${n}` : `${n}`; }
function toISO(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function parseISO(s: string) { const [y,m,d] = s.split("-").map(Number); return new Date(y, m-1, d); }
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate()+n); return r; }

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

export function StatisticsPage() {
  const { hasRole, loading } = useAuth();
  const canView = hasRole(["admin", "super_admin", "owner"]);

  const today = new Date();

  const minDate = addDays(today, -365);

  // Period state
  const [mode, setMode] = useState<PeriodMode>("month");
  const [monthVal, setMonthVal] = useState<string>(() => `${today.getFullYear()}-${pad(today.getMonth()+1)}`);
  const [weekVal, setWeekVal] = useState<string>(() => {
    const w = isoWeek(today); return `${w.year}-W${pad(w.week)}`;
  });
  const [yearVal, setYearVal] = useState<string>(() => `${today.getFullYear()}`);
  const [fromVal, setFromVal] = useState<string>(toISO(minDate));
  const [toVal, setToVal] = useState<string>(toISO(today));

  // Filter state (ALL or value)
  const [productF, setProductF] = useState<string>(ALL);
  const [countryF, setCountryF] = useState<string>(ALL);
  const [supplierF, setSupplierF] = useState<string>(ALL);
  const [managerF, setManagerF] = useState<string>(ALL);

  const [from, to] = useMemo<[Date, Date]>(() => {
    if (mode === "month") {
      const [y, m] = monthVal.split("-").map(Number);
      return [new Date(y, m - 1, 1), new Date(y, m, 0)];
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
    enabled: !loading && canView,
    queryFn: async () => {

      const cutoff = toISO(minDate);
      const [shRes, supRes, mgrRes] = await Promise.all([
        supabase
          .from("shipments")
          .select("id,country,loading_date,eta,arrived_at,created_at,supplier_id,import_manager_id, shipment_items(id,shipment_id,product_name,origin_country,pallet_count,unit_price,price_currency,final_cost_indicative,final_cost_invoice)")
          .gte("created_at", `${cutoff}T00:00:00`)
          .order("loading_date", { ascending: false })
          .limit(2000),
        supabase.from("suppliers").select("id,name").order("name"),
        supabase.from("import_managers").select("id,user_id,full_name").order("full_name"),
      ]);
      const shipments = ((shRes.data ?? []) as unknown as (ShipmentRow & { shipment_items: ItemRow[] })[]);
      return {
        shipments,
        suppliers: (supRes.data ?? []) as Supplier[],
        managers: (mgrRes.data ?? []) as Manager[],
      };
    },
  });

  const shipments = data?.shipments ?? [];
  const suppliers = data?.suppliers ?? [];
  const managers = data?.managers ?? [];
  const supplierMap = useMemo(() => Object.fromEntries(suppliers.map(s => [s.id, s.name])), [suppliers]);

  // Manager label map keyed by BOTH import_managers.id and import_managers.user_id,
  // because shipments may store either form in import_manager_id depending on
  // how the row was created. This is read-only — no data mutation.
  const managerLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const mgr of managers) {
      if (mgr.user_id) m.set(mgr.user_id, mgr.full_name);
      m.set(mgr.id, mgr.full_name);
    }
    return m;
  }, [managers]);
  const managerMap = useMemo(
    () => Object.fromEntries(managers.map((m) => [m.user_id ?? m.id, m.full_name])),
    [managers],
  );

  const NO_MANAGER = "__no_manager__";
  const NO_MANAGER_LABEL = "— Без менеджера";
  const UNKNOWN_MANAGER_LABEL = "— Менеджер не знайдений";

  const countryAliasMap = useCountryAliases();
  const productAliasMap = useProductAliases();
  const resolveCountry = (raw: string | null | undefined) => {
    const t = (raw ?? "").trim();
    if (!t) return "— Без країни";
    const alias = countryAliasMap[t.toLowerCase()];
    return alias ?? t;
  };

  type Flat = {
    item: ItemRow;
    shipment: ShipmentRow;
    date: string;
    country: string; // product origin only (or "— Без країни"); canonicalized via aliases
    productCanonical: string; // canonical product name via existing alias helper
    managerKey: string; // shipment.import_manager_id ?? NO_MANAGER
  };

  // Period-only flat — used for filter options AND aggregates.
  // Items WITHOUT pallets are kept so country/product options are not artificially
  // empty for historical periods; aggregates ignore items with pallet_count <= 0.
  const flatPeriod = useMemo<Flat[]>(() => {
    const out: Flat[] = [];
    for (const sh of shipments) {
      const dateStr = sh.loading_date ?? sh.arrived_at ?? sh.eta ?? sh.created_at.slice(0, 10);
      if (!dateStr) continue;
      if (dateStr < fromISOStr || dateStr > toISOStr) continue;
      for (const it of (sh.shipment_items ?? [])) {
        if (!it.product_name?.trim()) continue;
        out.push({
          item: it,
          shipment: sh,
          date: dateStr,
          country: resolveCountry(it.origin_country),
          productCanonical: canonicalizeProductName(it.product_name) || it.product_name.trim(),
          managerKey: sh.import_manager_id ?? NO_MANAGER,
        });
      }
    }
    return out;
  }, [shipments, fromISOStr, toISOStr, countryAliasMap]);

  // Leave-one-out: each filter's options reflect the dataset narrowed by all
  // OTHER active filters (AND). Current selection is always preserved.
  const passesExcept = (
    f: Flat,
    excl: "product" | "country" | "supplier" | "manager" | null,
  ) => {
    if (excl !== "product" && productF !== ALL && f.productCanonical !== productF) return false;
    if (excl !== "country" && countryF !== ALL && f.country !== countryF) return false;
    if (excl !== "supplier" && supplierF !== ALL && (f.shipment.supplier_id ?? "") !== supplierF) return false;
    if (excl !== "manager" && managerF !== ALL && f.managerKey !== managerF) return false;
    return true;
  };

  const productOptions = useMemo(() => {
    const set = new Set<string>();
    for (const f of flatPeriod) if (passesExcept(f, "product")) set.add(f.productCanonical);
    if (productF !== ALL) set.add(productF);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "uk"));
  }, [flatPeriod, countryF, supplierF, managerF, productF]);

  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const f of flatPeriod) if (passesExcept(f, "country")) set.add(f.country);
    if (countryF !== ALL) set.add(countryF);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "uk"));
  }, [flatPeriod, productF, supplierF, managerF, countryF]);

  const supplierOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const f of flatPeriod) {
      if (!passesExcept(f, "supplier")) continue;
      if (f.shipment.supplier_id) ids.add(f.shipment.supplier_id);
    }
    if (supplierF !== ALL) ids.add(supplierF);
    return suppliers.filter(s => ids.has(s.id));
  }, [flatPeriod, productF, countryF, managerF, supplierF, suppliers]);

  // Manager options: derived from distinct shipment.import_manager_id values
  // present in the filtered dataset (leave-one-out). Includes a synthetic
  // "— Без менеджера" bucket when null-manager rows exist and an
  // "— Менеджер не знайдений" label when the id has no row in import_managers.
  const managerOptions = useMemo(() => {
    const keys = new Set<string>();
    for (const f of flatPeriod) {
      if (!passesExcept(f, "manager")) continue;
      keys.add(f.managerKey);
    }
    if (managerF !== ALL) keys.add(managerF);
    return Array.from(keys)
      .map((k) => ({
        value: k,
        label:
          k === NO_MANAGER
            ? NO_MANAGER_LABEL
            : managerLabel.get(k) ?? UNKNOWN_MANAGER_LABEL,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "uk"));
  }, [flatPeriod, productF, countryF, supplierF, managerF, managerLabel]);

  // Final filtered rows — exclude zero-pallet items from numeric aggregation
  const rows = useMemo<Flat[]>(() => {
    return flatPeriod.filter(f => {
      if (!f.item.pallet_count || Number(f.item.pallet_count) <= 0) return false;
      return passesExcept(f, null);
    }).sort((a,b) => a.date.localeCompare(b.date));
  }, [flatPeriod, productF, countryF, supplierF, managerF]);

  // Aggregates
  const totals = useMemo(() => {
    let pallets = 0, priceSum = 0, priceCnt = 0, indSum = 0, indCnt = 0, invSum = 0, invCnt = 0;
    for (const r of rows) {
      pallets += Number(r.item.pallet_count ?? 0);
      if (r.item.unit_price) { priceSum += Number(r.item.unit_price); priceCnt++; }
      if (r.item.final_cost_indicative) { indSum += Number(r.item.final_cost_indicative); indCnt++; }
      if (r.item.final_cost_invoice) { invSum += Number(r.item.final_cost_invoice); invCnt++; }
    }
    return {
      pallets,
      avgPrice: priceCnt ? priceSum / priceCnt : 0,
      avgInd: indCnt ? indSum / indCnt : 0,
      avgInv: invCnt ? invSum / invCnt : 0,
    };
  }, [rows]);

  // Per-supplier breakdown
  const bySupplier = useMemo(() => {
    const map = new Map<string, { name: string; pallets: number; priceSum: number; priceCnt: number; indSum: number; indCnt: number; invSum: number; invCnt: number; rows: Flat[] }>();
    for (const r of rows) {
      const sid = r.shipment.supplier_id ?? "—";
      const name = supplierMap[sid] ?? "—";
      const cur = map.get(sid) ?? { name, pallets: 0, priceSum: 0, priceCnt: 0, indSum: 0, indCnt: 0, invSum: 0, invCnt: 0, rows: [] };
      cur.pallets += Number(r.item.pallet_count ?? 0);
      if (r.item.unit_price) { cur.priceSum += Number(r.item.unit_price); cur.priceCnt++; }
      if (r.item.final_cost_indicative) { cur.indSum += Number(r.item.final_cost_indicative); cur.indCnt++; }
      if (r.item.final_cost_invoice) { cur.invSum += Number(r.item.final_cost_invoice); cur.invCnt++; }
      cur.rows.push(r);
      map.set(sid, cur);
    }
    return Array.from(map.entries()).map(([id, v]) => ({
      id, name: v.name, pallets: v.pallets,
      avgPrice: v.priceCnt ? v.priceSum / v.priceCnt : 0,
      avgInd: v.indCnt ? v.indSum / v.indCnt : 0,
      avgInv: v.invCnt ? v.invSum / v.invCnt : 0,
      rows: v.rows,
    })).sort((a,b) => b.pallets - a.pallets);
  }, [rows, supplierMap]);

  // Period dropdown options
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

  const resetAll = () => { setProductF(ALL); setCountryF(ALL); setSupplierF(ALL); setManagerF(ALL); };

  const activeChips: string[] = [];
  if (productF !== ALL) activeChips.push(`Товар: ${productF}`);
  if (countryF !== ALL) activeChips.push(`Країна: ${countryF}`);
  if (supplierF !== ALL) activeChips.push(`Постачальник: ${supplierMap[supplierF] ?? "—"}`);
  if (managerF !== ALL) activeChips.push(`Менеджер: ${managerMap[managerF] ?? "—"}`);

  if (loading) return null;
  if (!canView) return <Navigate to="/" />;

  return (
    <div className="space-y-4">

      <PageHeader title="Статистика" subtitle="Останні 12 місяців" />

      {/* PERIOD */}
      <SectionCard title="Період">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {(["week","month","year","custom"] as PeriodMode[]).map(m => (
              <Button key={m} size="sm" variant={mode === m ? "default" : "outline"} onClick={() => setMode(m)}>
                {m === "week" ? "Тиждень" : m === "month" ? "Місяць" : m === "year" ? "Рік" : "Період"}
              </Button>
            ))}
          </div>
          {mode === "month" && (
            <Select value={monthVal} onValueChange={setMonthVal}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{monthOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          )}
          {mode === "week" && (
            <Select value={weekVal} onValueChange={setWeekVal}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{weekOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          )}
          {mode === "year" && (
            <Select value={yearVal} onValueChange={setYearVal}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{yearOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
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
          <p className="text-xs text-muted-foreground">{fmtDate(fromISOStr)} – {fmtDate(toISOStr)}</p>
        </div>
      </SectionCard>

      {/* FILTERS */}
      <SectionCard title="Фільтри">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="text-xs text-muted-foreground">Товар</label>
            <CompactFilterSelect
              value={productF}
              onChange={(v) => { setProductF(v); setCountryF(ALL); }}
              options={productOptions.map((p) => ({ value: p, label: p }))}
              aliases={productAliasMap}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Країна</label>
            <CompactFilterSelect
              value={countryF}
              onChange={setCountryF}
              options={countryOptions.map((c) => ({ value: c, label: c }))}
              aliases={countryAliasMap}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Постачальник</label>
            <CompactFilterSelect
              value={supplierF}
              onChange={setSupplierF}
              options={supplierOptions.map((s) => ({ value: s.id, label: s.name }))}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Імпорт-менеджер</label>
            <CompactFilterSelect
              value={managerF}
              onChange={setManagerF}
              options={managerOptions.map((m) => ({ value: m.user_id ?? m.id, label: m.full_name }))}
            />
          </div>
        </div>
        {activeChips.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {activeChips.map((c, i) => (
              <span key={i} className="rounded-full bg-secondary px-2 py-1 text-[11px]">{c}</span>
            ))}
            <Button size="sm" variant="ghost" onClick={resetAll}>Скинути</Button>
          </div>
        )}
        <div className="mt-3 grid grid-cols-4 gap-2 text-center">
          <div className="rounded-lg border border-border bg-card p-2">
            <div className="text-[10px] uppercase text-muted-foreground">Палет</div>
            <div className="text-base font-bold">{totals.pallets}</div>
          </div>
          <div className="rounded-lg border border-border bg-card p-2">
            <div className="text-[10px] uppercase text-muted-foreground">сер. зак.</div>
            <div className="text-base font-bold">{totals.avgPrice.toFixed(2)}</div>
          </div>
          <div className="rounded-lg border border-border bg-card p-2">
            <div className="text-[10px] uppercase text-success">сер. інд.</div>
            <div className="text-base font-bold text-success">{totals.avgInd.toFixed(2)}</div>
          </div>
          <div className="rounded-lg border border-border bg-card p-2">
            <div className="text-[10px] uppercase text-destructive">сер. інв.</div>
            <div className="text-base font-bold text-destructive">{totals.avgInv.toFixed(2)}</div>
          </div>
        </div>
      </SectionCard>

      {/* PRODUCTS — list of purchases */}
      <SectionCard title="Товари — закупки">
        {isLoading ? (
          <EmptyState title="Завантаження…" />
        ) : rows.length === 0 ? (
          <EmptyState title="Немає закупок" hint="За обраними фільтрами" />
        ) : (
          <div className="-mx-4 px-4">
            <table className="w-full caption-bottom border-collapse text-sm">
              <thead>
                <tr className="border-b">
                  <th className="sticky top-16 z-20 h-10 bg-table-head px-2 text-left align-middle text-xs font-bold text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur">Дата</th>
                  <th className="sticky top-16 z-20 h-10 bg-table-head px-2 text-left align-middle text-xs font-bold text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur">Товар</th>
                  <th className="sticky top-16 z-20 h-10 bg-table-head px-2 text-left align-middle text-xs font-bold text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur">Країна</th>
                  <th className="sticky top-16 z-20 h-10 bg-table-head px-2 text-left align-middle text-xs font-bold text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur">Постачальник</th>
                  <th className="sticky top-16 z-20 h-10 bg-table-head px-2 text-left align-middle text-xs font-bold text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur">Менеджер</th>
                  <th className="sticky top-16 z-20 h-10 bg-table-head px-2 text-right align-middle text-xs font-bold text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur">Палет</th>
                  <th className="sticky top-16 z-20 h-10 bg-table-head px-2 text-right align-middle text-xs font-bold text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur">Закупка</th>
                  <th className="sticky top-16 z-20 h-10 bg-table-head px-2 text-right align-middle text-xs font-bold text-success shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur">Індикатив</th>
                  <th className="sticky top-16 z-20 h-10 bg-table-head px-2 text-right align-middle text-xs font-bold text-destructive shadow-[0_1px_0_0_hsl(var(--border))] backdrop-blur">Інвойс</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.item.id} className="border-b transition-colors hover:bg-muted/50">
                    <td className="whitespace-nowrap p-2 align-middle">{fmtDate(r.date)}</td>
                    <td className="whitespace-nowrap p-2 align-middle">{r.productCanonical}</td>
                    <td className="whitespace-nowrap p-2 align-middle">{r.country}</td>
                    <td className="whitespace-nowrap p-2 align-middle">{supplierMap[r.shipment.supplier_id ?? ""] ?? "—"}</td>
                    <td className="whitespace-nowrap p-2 align-middle">{managerMap[r.shipment.import_manager_id ?? ""] ?? "—"}</td>
                    <td className="p-2 text-right align-middle">{fmtNum(r.item.pallet_count, 0)}</td>
                    <td className="p-2 text-right align-middle">{fmtNum(r.item.unit_price)}</td>
                    <td className="p-2 text-right align-middle font-semibold text-success tabular-nums">{fmtNum(r.item.final_cost_indicative)}</td>
                    <td className="p-2 text-right align-middle font-semibold text-destructive tabular-nums">{fmtNum(r.item.final_cost_invoice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* SUPPLIERS — aggregation */}
      <SectionCard title="Постачальники — порівняння">
        {bySupplier.length === 0 ? (
          <EmptyState title="Немає даних" hint="За обраними фільтрами" />
        ) : (
          <div className="space-y-3">
            {bySupplier.map(g => (
              <div key={g.id} className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold">{g.name}</div>
                  <div className="text-xs"><span className="text-muted-foreground">{g.pallets} п • зак. {g.avgPrice.toFixed(2)} • </span><span className="text-success font-semibold">інд. {g.avgInd.toFixed(2)}</span><span className="text-muted-foreground"> / </span><span className="text-destructive font-semibold">інв. {g.avgInv.toFixed(2)}</span></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

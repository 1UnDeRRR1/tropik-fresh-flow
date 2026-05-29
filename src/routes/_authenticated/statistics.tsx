import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { useAuth } from "@/lib/auth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canonicalizeProductName } from "@/lib/product-aliases";
import { useCountryAliases } from "@/hooks/useCountryAliases";

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
  if (loading) return null;
  if (!hasRole(["admin", "super_admin", "owner"])) return <Navigate to="/" />;

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
  const managerMap = useMemo(
    () => Object.fromEntries(managers.map((m) => [m.user_id ?? m.id, m.full_name])),
    [managers],
  );

  const countryAliasMap = useCountryAliases();
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
        });
      }
    }
    return out;
  }, [shipments, fromISOStr, toISOStr, countryAliasMap]);

  // Filter options derived from period (so they react)
  const productOptions = useMemo(() => {
    const set = new Set<string>();
    for (const f of flatPeriod) set.add(f.productCanonical);
    return Array.from(set).sort((a,b) => a.localeCompare(b, "uk"));
  }, [flatPeriod]);

  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const f of flatPeriod) {
      if (productF === ALL || f.productCanonical === productF) set.add(f.country);
    }
    return Array.from(set).sort((a,b) => a.localeCompare(b, "uk"));
  }, [flatPeriod, productF]);

  const supplierOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const f of flatPeriod) {
      if (productF !== ALL && f.productCanonical !== productF) continue;
      if (countryF !== ALL && f.country !== countryF) continue;
      if (f.shipment.supplier_id) ids.add(f.shipment.supplier_id);
    }
    return suppliers.filter(s => ids.has(s.id));
  }, [flatPeriod, productF, countryF, suppliers]);

  const managerOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const f of flatPeriod) {
      if (productF !== ALL && f.productCanonical !== productF) continue;
      if (countryF !== ALL && f.country !== countryF) continue;
      if (supplierF !== ALL && f.shipment.supplier_id !== supplierF) continue;
      if (f.shipment.import_manager_id) ids.add(f.shipment.import_manager_id);
    }
    return managers.filter((m) => ids.has(m.user_id ?? "") || ids.has(m.id));
  }, [flatPeriod, productF, countryF, supplierF, managers]);

  // Final filtered rows — exclude zero-pallet items from numeric aggregation
  const rows = useMemo<Flat[]>(() => {
    return flatPeriod.filter(f => {
      if (!f.item.pallet_count || Number(f.item.pallet_count) <= 0) return false;
      if (productF !== ALL && f.productCanonical !== productF) return false;
      if (countryF !== ALL && f.country !== countryF) return false;
      if (supplierF !== ALL && f.shipment.supplier_id !== supplierF) return false;
      if (managerF !== ALL && f.shipment.import_manager_id !== managerF) return false;
      return true;
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
            <SearchableSelect
              value={productF}
              onChange={(v) => { setProductF(v); setCountryF(ALL); }}
              options={productOptions.map((p) => ({ value: p, label: p }))}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Країна</label>
            <SearchableSelect
              value={countryF}
              onChange={setCountryF}
              options={countryOptions.map((c) => ({ value: c, label: c }))}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Постачальник</label>
            <SearchableSelect
              value={supplierF}
              onChange={setSupplierF}
              options={supplierOptions.map((s) => ({ value: s.id, label: s.name }))}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Імпорт-менеджер</label>
            <SearchableSelect
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
            <table className="w-full caption-bottom text-sm">
              <TableHeader className="sticky top-16 z-20 backdrop-blur shadow-[0_1px_0_0_hsl(var(--border))] [&_th]:bg-table-head [&_th]:font-bold">
                <TableRow className="hover:bg-transparent">
                  <TableHead>Дата</TableHead>
                  <TableHead>Товар</TableHead>
                  <TableHead>Країна</TableHead>
                  <TableHead>Постачальник</TableHead>
                  <TableHead>Менеджер</TableHead>
                  <TableHead className="text-right">Палет</TableHead>
                  <TableHead className="text-right">Закупка</TableHead>
                  <TableHead className="text-right text-success">Індикатив</TableHead>
                  <TableHead className="text-right text-destructive">Інвойс</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(r => (
                  <TableRow key={r.item.id}>
                    <TableCell className="whitespace-nowrap">{fmtDate(r.date)}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.productCanonical}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.country}</TableCell>
                    <TableCell className="whitespace-nowrap">{supplierMap[r.shipment.supplier_id ?? ""] ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{managerMap[r.shipment.import_manager_id ?? ""] ?? "—"}</TableCell>
                    <TableCell className="text-right">{fmtNum(r.item.pallet_count, 0)}</TableCell>
                    <TableCell className="text-right">{fmtNum(r.item.unit_price)}</TableCell>
                    <TableCell className="text-right font-semibold text-success tabular-nums">{fmtNum(r.item.final_cost_indicative)}</TableCell>
                    <TableCell className="text-right font-semibold text-destructive tabular-nums">{fmtNum(r.item.final_cost_invoice)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
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

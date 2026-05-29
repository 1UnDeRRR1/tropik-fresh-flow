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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { canonicalizeProductName } from "@/lib/product-aliases";
import { useCountryAliases } from "@/hooks/useCountryAliases";
import { useProductAliases } from "@/hooks/useProductAliases";
import { CostPair } from "@/components/CostPair";

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
  net_weight_kg: number | null;
  unit_price: number | null;
  price_currency: string | null;
  final_cost_indicative: number | null;
  final_cost_invoice: number | null;
};

type ShipmentRow = {
  id: string;
  code: string | null;
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

type Metric = "purchase" | "cost" | "both";
type CompareMode = "managers" | "suppliers" | "products";

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

type Flat = {
  item: ItemRow;
  shipment: ShipmentRow;
  date: string;
  country: string;
  productCanonical: string;
  managerKey: string;
};

// Volume for weighted averages: net_weight_kg if > 0, else pallet_count if > 0, else 0
function volumeOf(it: ItemRow): number {
  const w = Number(it.net_weight_kg ?? 0);
  if (w > 0) return w;
  const p = Number(it.pallet_count ?? 0);
  return p > 0 ? p : 0;
}

function weightedAvg(rows: Flat[], getPrice: (it: ItemRow) => number | null | undefined): number {
  let num = 0, den = 0;
  for (const r of rows) {
    const p = getPrice(r.item);
    if (p == null || !Number.isFinite(Number(p))) continue;
    const v = volumeOf(r.item);
    if (v <= 0) continue;
    num += Number(p) * v;
    den += v;
  }
  return den > 0 ? num / den : 0;
}

function sumPallets(rows: Flat[]): number {
  let s = 0;
  for (const r of rows) s += Number(r.item.pallet_count ?? 0);
  return s;
}

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

  // Filter state
  const [productF, setProductF] = useState<string>(ALL);
  const [countryF, setCountryF] = useState<string>(ALL);
  const [supplierF, setSupplierF] = useState<string>(ALL);
  const [managerF, setManagerF] = useState<string>(ALL);

  // UI mode
  const [metric, setMetric] = useState<Metric>("purchase");
  const [compareMode, setCompareMode] = useState<CompareMode>("managers");
  const [dateBasis, setDateBasis] = useState<"loading" | "arrival">("loading");

  // Drill-down dialog
  const [drill, setDrill] = useState<
    | null
    | { kind: CompareMode; key: string; label: string }
  >(null);

  // Full purchases table dialog
  const [fullTableOpen, setFullTableOpen] = useState(false);

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
          .select("id,code,country,loading_date,eta,arrived_at,created_at,supplier_id,import_manager_id, shipment_items(id,shipment_id,product_name,origin_country,pallet_count,net_weight_kg,unit_price,price_currency,final_cost_indicative,final_cost_invoice)")
          .gte("created_at", `${cutoff}T00:00:00`)
          .order("loading_date", { ascending: false })
          .limit(2000),
        supabase.from("suppliers").select("id,name").order("name"),
        supabase.from("import_managers").select("id,user_id,full_name").order("full_name"),
      ]);
      if (shRes.error) throw shRes.error;
      if (supRes.error) throw supRes.error;
      if (mgrRes.error) throw mgrRes.error;
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

  const managerLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const mgr of managers) {
      if (mgr.user_id) m.set(mgr.user_id, mgr.full_name);
      m.set(mgr.id, mgr.full_name);
    }
    return m;
  }, [managers]);

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

  const flatPeriod = useMemo<Flat[]>(() => {
    const out: Flat[] = [];
    for (const sh of shipments) {
      const dateStr = dateBasis === "loading"
        ? (sh.loading_date ?? sh.arrived_at ?? sh.eta ?? sh.created_at.slice(0, 10))
        : (sh.arrived_at ?? sh.eta ?? sh.loading_date ?? sh.created_at.slice(0, 10));
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
  }, [shipments, fromISOStr, toISOStr, countryAliasMap, dateBasis]);

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

  const rows = useMemo<Flat[]>(() => {
    return flatPeriod.filter(f => {
      if (!f.item.pallet_count || Number(f.item.pallet_count) <= 0) return false;
      return passesExcept(f, null);
    }).sort((a,b) => a.date.localeCompare(b.date));
  }, [flatPeriod, productF, countryF, supplierF, managerF]);

  const totals = useMemo(() => ({
    pallets: sumPallets(rows),
    avgPrice: weightedAvg(rows, (it) => it.unit_price),
    avgInd: weightedAvg(rows, (it) => it.final_cost_indicative),
    avgInv: weightedAvg(rows, (it) => it.final_cost_invoice),
  }), [rows]);

  const managerLabelFor = (key: string) =>
    key === NO_MANAGER ? NO_MANAGER_LABEL : managerLabel.get(key) ?? UNKNOWN_MANAGER_LABEL;

  // Unified comparison list: each row carries key + label + pallets + weighted averages.
  // Products are grouped by productCanonical + country (key uses "||" separator).
  const compareList = useMemo(() => {
    const groups = new Map<string, Flat[]>();
    const labels = new Map<string, string>();
    for (const r of rows) {
      let key: string;
      let label: string;
      if (compareMode === "managers") {
        key = r.managerKey;
        label = managerLabelFor(r.managerKey);
      } else if (compareMode === "suppliers") {
        key = r.shipment.supplier_id ?? "—";
        label = supplierMap[r.shipment.supplier_id ?? ""] ?? "—";
      } else {
        key = `${r.productCanonical}||${r.country}`;
        label = `${r.productCanonical} · ${r.country}`;
      }
      let arr = groups.get(key);
      if (!arr) { arr = []; groups.set(key, arr); }
      arr.push(r);
      if (!labels.has(key)) labels.set(key, label);
    }
    return Array.from(groups.entries())
      .map(([key, grpRows]) => ({
        key,
        label: labels.get(key) ?? key,
        pallets: sumPallets(grpRows),
        avgPrice: weightedAvg(grpRows, (it) => it.unit_price),
        avgInd: weightedAvg(grpRows, (it) => it.final_cost_indicative),
        avgInv: weightedAvg(grpRows, (it) => it.final_cost_invoice),
        rows: grpRows,
      }))
      .sort((a, b) => b.pallets - a.pallets);
  }, [rows, compareMode, supplierMap, managerLabel]);

  // Drill-down rows for currently opened group
  const drillRows = useMemo<Flat[]>(() => {
    if (!drill) return [];
    if (drill.kind === "managers") return rows.filter((r) => r.managerKey === drill.key);
    if (drill.kind === "suppliers") return rows.filter((r) => (r.shipment.supplier_id ?? "—") === drill.key);
    // products: key = productCanonical||country
    const [p, c] = drill.key.split("||");
    return rows.filter((r) => r.productCanonical === p && r.country === c);
  }, [drill, rows]);

  const drillTotals = useMemo(() => ({
    pallets: sumPallets(drillRows),
    avgPrice: weightedAvg(drillRows, (it) => it.unit_price),
    avgInd: weightedAvg(drillRows, (it) => it.final_cost_indicative),
    avgInv: weightedAvg(drillRows, (it) => it.final_cost_invoice),
  }), [drillRows]);

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
  const shipmentLabel = (sh: ShipmentRow) => {
    const code = (sh.code ?? "").trim();
    if (code) return code;
    return sh.id ? sh.id.slice(-6) : "—";
  };

  const resetAll = () => { setProductF(ALL); setCountryF(ALL); setSupplierF(ALL); setManagerF(ALL); };

  const activeChips: string[] = [];
  if (productF !== ALL) activeChips.push(`Товар: ${productF}`);
  if (countryF !== ALL) activeChips.push(`Країна: ${countryF}`);
  if (supplierF !== ALL) activeChips.push(`Постачальник: ${supplierMap[supplierF] ?? "—"}`);
  if (managerF !== ALL) activeChips.push(`Менеджер: ${managerLabelFor(managerF)}`);

  const showPrice = metric === "purchase" || metric === "both";
  const showCost = metric === "cost" || metric === "both";

  if (loading) return null;
  if (!canView) return <Navigate to="/" />;

  // Comparison row metric chips
  const renderCompareMeta = (g: { pallets: number; avgPrice: number; avgInd: number; avgInv: number }) => (
    <span className="shrink-0 text-xs tabular-nums">
      <span className="font-bold text-brand">{g.pallets}п</span>
      {showPrice && <> · <span className="text-muted-foreground">зак.</span> <span className="font-semibold">{g.avgPrice.toFixed(2)}</span></>}
      {showCost && <> · <span className="text-success font-semibold">інд. {g.avgInd.toFixed(2)}</span></>}
      {showCost && <> · <span className="text-destructive font-semibold">інв. {g.avgInv.toFixed(2)}</span></>}
    </span>
  );

  // Preview rows for "Товари — закупки"
  const PREVIEW_LIMIT = 8;
  const previewRows = rows.slice(0, PREVIEW_LIMIT);

  const renderPurchaseTable = (data: Flat[]) => (
    <div className="relative">
      <div className="overflow-x-auto overscroll-x-contain">
        <table className="w-full min-w-[920px] caption-bottom border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <th className="h-9 bg-table-head px-1.5 text-left align-middle text-xs font-bold text-muted-foreground">Дата</th>
              <th className="h-9 bg-table-head px-1.5 text-left align-middle text-xs font-bold text-muted-foreground">Поставка</th>
              <th className="h-9 bg-table-head px-1.5 text-left align-middle text-xs font-bold text-muted-foreground">Товар</th>
              <th className="h-9 bg-table-head px-1.5 text-left align-middle text-xs font-bold text-muted-foreground">Країна</th>
              <th className="h-9 bg-table-head px-1.5 text-left align-middle text-xs font-bold text-muted-foreground">Постачальник</th>
              <th className="h-9 bg-table-head px-1.5 text-left align-middle text-xs font-bold text-muted-foreground">Менеджер</th>
              <th className="h-9 bg-table-head px-1.5 text-right align-middle text-xs font-bold text-muted-foreground">Палет</th>
              {showPrice && <th className="h-9 bg-table-head px-1.5 text-right align-middle text-xs font-bold text-muted-foreground">Закупка</th>}
              {showCost && <th className="h-9 bg-table-head px-1.5 text-right align-middle text-xs font-bold text-success">Індикатив</th>}
              {showCost && <th className="h-9 bg-table-head px-1.5 text-right align-middle text-xs font-bold text-destructive">Інвойс</th>}
            </tr>
          </thead>
          <tbody>
            {data.map(r => (
              <tr key={r.item.id} className="border-b transition-colors hover:bg-muted/50">
                <td className="whitespace-nowrap p-1.5 align-middle">{fmtDate(r.date)}</td>
                <td className="whitespace-nowrap p-1.5 align-middle text-xs text-muted-foreground">{shipmentLabel(r.shipment)}</td>
                <td className="whitespace-nowrap p-1.5 align-middle">{r.productCanonical}</td>
                <td className="whitespace-nowrap p-1.5 align-middle">{r.country}</td>
                <td className="whitespace-nowrap p-1.5 align-middle">{supplierMap[r.shipment.supplier_id ?? ""] ?? "—"}</td>
                <td className="whitespace-nowrap p-1.5 align-middle">{managerLabelFor(r.managerKey)}</td>
                <td className="p-1.5 text-right align-middle tabular-nums">{fmtNum(r.item.pallet_count, 0)}</td>
                {showPrice && <td className="p-1.5 text-right align-middle tabular-nums">{fmtNum(r.item.unit_price)}</td>}
                {showCost && <td className="p-1.5 text-right align-middle font-semibold text-success tabular-nums">{fmtNum(r.item.final_cost_indicative)}</td>}
                {showCost && <td className="p-1.5 text-right align-middle font-semibold text-destructive tabular-nums">{fmtNum(r.item.final_cost_invoice)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-card to-transparent sm:hidden" />
    </div>
  );

  // Mobile-first detail list (Analytics-style cards)
  const renderDetailList = (data: Flat[]) => (
    <ul className="divide-y divide-border">
      {data
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((f) => {
          const it = f.item;
          const sh = f.shipment;
          const pallets = Number(it.pallet_count ?? 0);
          const net = Number(it.net_weight_kg ?? 0);
          const currency = it.price_currency ?? "";
          return (
            <li key={`${sh.id}-${it.id}`} className="flex flex-col gap-1 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold">
                  {dateBasis === "loading" ? "Завант." : "ETA"} {fmtDate(f.date)}
                </span>
                <span className="shrink-0 text-sm font-bold tabular-nums text-brand">{pallets}п</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                <span className="font-mono text-foreground">{shipmentLabel(sh)}</span>
                <span className="truncate">{f.productCanonical}</span>
                <span>·</span>
                <span>{f.country}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                <span>{supplierMap[sh.supplier_id ?? ""] ?? "—"}</span>
                {net > 0 ? <span>{Math.round(net)} кг</span> : null}
              </div>
              {(showPrice || showCost) && (
                <div className="flex flex-wrap items-center gap-x-2 text-[11px]">
                  {showPrice && (
                    <span className="text-muted-foreground">
                      закуп. {fmtNum(it.unit_price)} {currency}
                    </span>
                  )}
                  {showCost && (
                    <CostPair
                      indicative={it.final_cost_indicative}
                      invoice={it.final_cost_invoice}
                      suffix=" кг"
                      prefix=""
                      size="xs"
                    />
                  )}
                </div>
              )}
              <div className="text-[11px] text-muted-foreground">
                Менеджер: {managerLabelFor(f.managerKey)}
              </div>
            </li>
          );
        })}
    </ul>
  );


  const subtitle = (() => {
    if (mode === "month") {
      const [y, m] = monthVal.split("-").map(Number);
      return `${UK_MONTHS[m - 1]} ${y}`;
    }
    if (mode === "year") return yearVal;
    if (mode === "week") {
      const [y, w] = weekVal.split("-W").map(Number);
      const [s, e] = weekRange(y, w);
      return `Тиждень ${w} · ${fmtDate(toISO(s))} – ${fmtDate(toISO(e))}`;
    }
    return `${fmtDate(fromISOStr)} – ${fmtDate(toISOStr)}`;
  })();

  const emptyHint = dateBasis === "arrival"
    ? "За обраний період немає поставок за датою прибуття. Спробуйте інший місяць або переключіть Дата → Завантаження."
    : "За обраний період немає поставок за датою завантаження. Спробуйте інший період.";

  return (
    <div className="space-y-4">
      <PageHeader title="Статистика" subtitle={subtitle} />

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
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs text-muted-foreground">Дата:</span>
            <Button size="sm" variant={dateBasis === "loading" ? "default" : "outline"} onClick={() => setDateBasis("loading")}>Завантаження</Button>
            <Button size="sm" variant={dateBasis === "arrival" ? "default" : "outline"} onClick={() => setDateBasis("arrival")}>Прибуття</Button>
          </div>
          <p className="text-xs text-muted-foreground">{fmtDate(fromISOStr)} – {fmtDate(toISOStr)} · {dateBasis === "loading" ? "за датою завантаження" : "за датою прибуття"}</p>
        </div>
      </SectionCard>

      {/* FILTERS */}
      <SectionCard title="Фільтри">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="text-xs text-muted-foreground">Товар</label>
            <CompactFilterSelect
              value={productF}
              onChange={setProductF}
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
              searchable={false}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Імпорт-менеджер</label>
            <CompactFilterSelect
              value={managerF}
              onChange={setManagerF}
              options={managerOptions}
              searchable={false}
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
      </SectionCard>

      {/* METRIC TOGGLE */}
      <SectionCard title="Показник">
        <div className="flex flex-wrap gap-2">
          {([
            ["purchase", "Закупка"],
            ["cost", "Собівартість"],
            ["both", "Обидва"],
          ] as const).map(([k, lbl]) => (
            <Button
              key={k}
              size="sm"
              variant={metric === k ? "default" : "outline"}
              onClick={() => setMetric(k)}
            >
              {lbl}
            </Button>
          ))}
        </div>
        <div className={`mt-3 grid gap-2 text-center ${
          metric === "purchase" ? "grid-cols-2" : metric === "cost" ? "grid-cols-3" : "grid-cols-4"
        }`}>
          <div className="rounded-lg border border-border bg-card p-2">
            <div className="text-[10px] uppercase text-muted-foreground">Палет</div>
            <div className="text-base font-bold">{totals.pallets}</div>
          </div>
          {showPrice && (
            <div className="rounded-lg border border-border bg-card p-2">
              <div className="text-[10px] uppercase text-muted-foreground">сер. зак.</div>
              <div className="text-base font-bold">{totals.avgPrice.toFixed(2)}</div>
            </div>
          )}
          {showCost && (
            <div className="rounded-lg border border-border bg-card p-2">
              <div className="text-[10px] uppercase text-success">сер. інд.</div>
              <div className="text-base font-bold text-success">{totals.avgInd.toFixed(2)}</div>
            </div>
          )}
          {showCost && (
            <div className="rounded-lg border border-border bg-card p-2">
              <div className="text-[10px] uppercase text-destructive">сер. інв.</div>
              <div className="text-base font-bold text-destructive">{totals.avgInv.toFixed(2)}</div>
            </div>
          )}
        </div>
      </SectionCard>

      {/* COMPARISON */}
      <SectionCard title="Порівняння">
        <div className="mb-3 flex flex-wrap gap-2">
          {([
            ["managers", "Менеджери"],
            ["suppliers", "Постачальники"],
            ["products", "Товари"],
          ] as const).map(([k, lbl]) => (
            <Button
              key={k}
              size="sm"
              variant={compareMode === k ? "default" : "outline"}
              onClick={() => setCompareMode(k)}
            >
              {lbl}
            </Button>
          ))}
        </div>
        {compareList.length === 0 ? (
          <EmptyState title="Немає даних" hint={flatPeriod.length === 0 ? emptyHint : "За обраними фільтрами"} />
        ) : (
          <ul className="divide-y divide-border">
            {compareList.map((g) => (
              <li key={g.key}>
                <button
                  type="button"
                  onClick={() => setDrill({ kind: compareMode, key: g.key, label: g.label })}
                  className="flex w-full items-center justify-between gap-2 py-2 text-left hover:bg-muted/40 rounded px-1 -mx-1"
                >
                  <span className="truncate text-sm">{g.label}</span>
                  {renderCompareMeta(g)}
                </button>
              </li>
            ))}
            <li className="flex items-center justify-between gap-2 border-t border-border py-2 font-semibold">
              <span className="text-sm">Разом</span>
              <span className="text-sm tabular-nums">{totals.pallets}п</span>
            </li>
          </ul>
        )}
      </SectionCard>

      {/* PRODUCTS — collapsed preview */}
      <SectionCard title="Товари — закупки">
        {isLoading ? (
          <EmptyState title="Завантаження…" />
        ) : rows.length === 0 ? (
          <EmptyState title="Немає закупок" hint={flatPeriod.length === 0 ? emptyHint : "За обраними фільтрами"} />
        ) : (
          <>
            {renderPurchaseTable(previewRows)}
            <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>Показано {Math.min(PREVIEW_LIMIT, rows.length)} з {rows.length}</span>
              {rows.length > PREVIEW_LIMIT && (
                <Button size="sm" variant="outline" onClick={() => setFullTableOpen(true)}>
                  Розгорнути всі закупки
                </Button>
              )}
            </div>
          </>
        )}
      </SectionCard>

      {/* DRILL-DOWN DIALOG — Analytics-style list */}
      <Dialog open={!!drill} onOpenChange={(o) => { if (!o) setDrill(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="pr-10 text-base break-words">
              {drill?.label ?? ""}
            </DialogTitle>
          </DialogHeader>
          <div className={`grid gap-2 text-center ${
            metric === "purchase" ? "grid-cols-2" : metric === "cost" ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-4"
          }`}>
            <div className="rounded-lg border border-border bg-card p-2">
              <div className="text-[10px] uppercase text-muted-foreground">Палет</div>
              <div className="text-base font-bold">{drillTotals.pallets}</div>
            </div>
            {showPrice && (
              <div className="rounded-lg border border-border bg-card p-2">
                <div className="text-[10px] uppercase text-muted-foreground">сер. зак.</div>
                <div className="text-base font-bold">{drillTotals.avgPrice.toFixed(2)}</div>
              </div>
            )}
            {showCost && (
              <div className="rounded-lg border border-border bg-card p-2">
                <div className="text-[10px] uppercase text-success">сер. інд.</div>
                <div className="text-base font-bold text-success">{drillTotals.avgInd.toFixed(2)}</div>
              </div>
            )}
            {showCost && (
              <div className="rounded-lg border border-border bg-card p-2">
                <div className="text-[10px] uppercase text-destructive">сер. інв.</div>
                <div className="text-base font-bold text-destructive">{drillTotals.avgInv.toFixed(2)}</div>
              </div>
            )}
          </div>
          {drillRows.length === 0 ? (
            <EmptyState title="Немає рядків" />
          ) : (
            renderDetailList(drillRows)
          )}
        </DialogContent>
      </Dialog>

      {/* FULL PURCHASES DIALOG — same list layout */}
      <Dialog open={fullTableOpen} onOpenChange={setFullTableOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="pr-10 text-base break-words">Товари — закупки ({rows.length})</DialogTitle>
          </DialogHeader>
          {rows.length === 0 ? <EmptyState title="Немає рядків" /> : renderDetailList(rows)}
        </DialogContent>
      </Dialog>
    </div>
  );
}

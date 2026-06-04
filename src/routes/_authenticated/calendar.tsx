import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { EmptyState } from "@/components/cards";
import { useAuth } from "@/lib/auth";

import { StaffOnly } from "@/components/StaffOnly";
import { CostPair } from "@/components/CostPair";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CompactFilterSelect } from "@/components/CompactFilterSelect";
import { useReadOnly } from "@/components/ReadOnlyShell";
import { useProductAliases } from "@/hooks/useProductAliases";
import { useCountryAliases } from "@/hooks/useCountryAliases";
import { countPositionsFromGroups, formatPositions } from "@/lib/positions";
import { toUaCountry, toShortUaCountry } from "@/lib/countries";

const shortenManagerName = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0]} ${parts[1].charAt(0)}.`;
};

export const Route = createFileRoute("/_authenticated/calendar")({
  component: () => <StaffOnly><CalendarPage /></StaffOnly>,
});

const ALL = "__all";
const NO_COUNTRY = "__no_country__";
const NO_COUNTRY_LABEL = "— Без країни";

type ShipmentItem = {
  id: string;
  product_name: string;
  origin_country: string | null;
  unit_price: number | null;
  price_currency: string | null;
  pallet_count: number | null;
  pallet_weight: number | null;
  caliber: string | null;
  variety: string | null;
  brand: string | null;
  class: string | null;
  package_used: string | null;
  sku: string | null;
  indicative_price: number | null;
  invoice_price: number | null;
  final_cost_indicative: number | null;
  final_cost_invoice: number | null;
};

type ShipmentRow = {
  id: string;
  code: string;
  country: string | null;
  eta: string | null;
  arrived_at: string | null;
  import_manager_id: string | null;
  shipment_items: ShipmentItem[];
};

type Manager = { id: string; full_name: string; user_id: string | null };
type Branch = { id: string; name: string };
type DistItem = { shipment_item_id: string; pallets: number | null };
type Dist = { branch_id: string; shipment_id: string; distribution_items: DistItem[] };

const WEEKDAYS_UK = ["Неділя", "Понеділок", "Вівторок", "Середа", "Четвер", "Пʼятниця", "Субота"];
const MONTHS_UK = [
  "січня", "лютого", "березня", "квітня", "травня", "червня",
  "липня", "серпня", "вересня", "жовтня", "листопада", "грудня",
];

function isoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function surname(full: string) {
  const parts = full.trim().split(/\s+/);
  return parts[0] ?? "";
}


export function CalendarPage() {
  const { user, hasRole } = useAuth();
  const isStaffAll = hasRole(["admin", "super_admin", "owner"]);
  const isReadOnly = useReadOnly();
  const productAliases = useProductAliases();
  const countryAliases = useCountryAliases();
  const [productFilter, setProductFilter] = useState<string>(ALL);
  const [countryFilter, setCountryFilter] = useState<string>(ALL);
  const [managerFilter, setManagerFilter] = useState<string>(ALL);
  const [branchFilter, setBranchFilter] = useState<string>(ALL);
  const [openItem, setOpenItem] = useState<{ sh: ShipmentRow; it: ShipmentItem } | null>(null);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const fromISO = isoDate(today);

  const { data, isLoading } = useQuery({
    queryKey: ["calendar-shipments", user?.id, isStaffAll, fromISO],
    enabled: !!user,
    queryFn: async () => {
      const { data: managerId } = !isStaffAll
        ? await supabase.rpc("current_import_manager_id")
        : { data: null };
      let sq = supabase
        .from("shipments")
        .select(
          "id,code,country,eta,arrived_at,import_manager_id, shipment_items(id,product_name,origin_country,unit_price,price_currency,pallet_count,pallet_weight,caliber,final_cost_indicative,final_cost_invoice)",
        );
      if (!isStaffAll && managerId) sq = sq.eq("import_manager_id", managerId);
      const [shRes, mgrRes, brRes, distRes] = await Promise.all([
        sq,
        supabase.from("import_managers").select("id,full_name,user_id"),
        supabase.from("branches").select("id,name").eq("is_active", true),
        supabase.from("distributions").select("branch_id,shipment_id, distribution_items(shipment_item_id,pallets)"),
      ]);
      if (shRes.error) throw shRes.error;
      return {
        shipments: (shRes.data ?? []) as ShipmentRow[],
        managers: (mgrRes.data ?? []) as Manager[],
        branches: (brRes.data ?? []) as Branch[],
        distributions: (distRes.data ?? []) as Dist[],
      };
    },
  });

  const mgrMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const mgr of data?.managers ?? []) {
      if (mgr.user_id) m.set(mgr.user_id, mgr.full_name);
      m.set(mgr.id, mgr.full_name);
    }
    return m;
  }, [data]);
  const brMap = useMemo(() => new Map((data?.branches ?? []).map((b) => [b.id, b.name])), [data]);

  const distByItem = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const d of data?.distributions ?? []) {
      for (const di of d.distribution_items ?? []) {
        const inner = m.get(di.shipment_item_id) ?? new Map<string, number>();
        inner.set(d.branch_id, (inner.get(d.branch_id) ?? 0) + Number(di.pallets ?? 0));
        m.set(di.shipment_item_id, inner);
      }
    }
    return m;
  }, [data]);

  // Build per-date entries (only future/today, only with items having pallets > 0)
  type Entry = { sh: ShipmentRow; it: ShipmentItem; key: string };

  const allEntries: Entry[] = useMemo(() => {
    const out: Entry[] = [];
    for (const sh of data?.shipments ?? []) {
      const arrival = sh.arrived_at ?? sh.eta;
      if (!arrival || arrival < fromISO) continue;
      for (const it of sh.shipment_items ?? []) {
        if (Number(it.pallet_count ?? 0) <= 0) continue;
        out.push({ sh, it, key: `${arrival}__${sh.id}__${it.id}` });
      }
    }
    return out;
  }, [data, fromISO]);

  // Branch-aware visible pallets: when a branch is selected, totals reflect
  // ONLY that branch's allocation for the item, not the full pallet_count.
  const getVisiblePallets = (e: Entry): number => {
    if (branchFilter === ALL) return Number(e.it.pallet_count ?? 0);
    return distByItem.get(e.it.id)?.get(branchFilter) ?? 0;
  };

  // Leave-one-out: each filter's options reflect the dataset narrowed by all
  // OTHER active filters (AND). The active value is preserved in its own list.
  const passes = (
    e: Entry,
    excl: "product" | "country" | "manager" | "branch" | null,
  ) => {
    if (excl !== "product" && productFilter !== ALL && e.it.product_name.trim() !== productFilter) return false;
    if (excl !== "country" && countryFilter !== ALL) {
      const c = (e.it.origin_country ?? "").trim();
      if (countryFilter === NO_COUNTRY ? c !== "" : c !== countryFilter) return false;
    }
    if (excl !== "manager" && managerFilter !== ALL && e.sh.import_manager_id !== managerFilter) return false;
    if (excl !== "branch" && branchFilter !== ALL) {
      const inner = distByItem.get(e.it.id);
      if (!inner || (inner.get(branchFilter) ?? 0) <= 0) return false;
    }
    return true;
  };

  const productOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of allEntries) {
      if (!passes(e, "product")) continue;
      const name = e.it.product_name.trim();
      if (name) set.add(name);
    }
    if (productFilter !== ALL) set.add(productFilter);
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b, "uk"))
      .map((name) => ({ value: name, label: name }));
  }, [allEntries, countryFilter, managerFilter, branchFilter, productFilter, distByItem]);

  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    let hasMissing = false;
    for (const e of allEntries) {
      if (!passes(e, "country")) continue;
      const c = (e.it.origin_country ?? "").trim();
      if (c) set.add(c);
      else hasMissing = true;
    }
    const arr = Array.from(set)
      .sort((a, b) => a.localeCompare(b, "uk"))
      .map((c) => ({ value: c, label: c }));
    if (hasMissing || countryFilter === NO_COUNTRY) arr.push({ value: NO_COUNTRY, label: NO_COUNTRY_LABEL });
    return arr;
  }, [allEntries, productFilter, managerFilter, branchFilter, countryFilter, distByItem]);

  const managerOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const e of allEntries) {
      if (!passes(e, "manager")) continue;
      const id = e.sh.import_manager_id;
      if (id) ids.add(id);
    }
    if (managerFilter !== ALL) ids.add(managerFilter);
    return Array.from(ids)
      .map((id) => ({ value: id, label: mgrMap.get(id) ?? "— Менеджер не знайдений" }))
      .sort((a, b) => a.label.localeCompare(b.label, "uk"));
  }, [allEntries, productFilter, countryFilter, branchFilter, managerFilter, distByItem, mgrMap]);

  const branchOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const e of allEntries) {
      if (!passes(e, "branch")) continue;
      const inner = distByItem.get(e.it.id);
      if (!inner) continue;
      for (const [bid, p] of inner.entries()) {
        if (Number(p) > 0) ids.add(bid);
      }
    }
    if (branchFilter !== ALL) ids.add(branchFilter);
    return (data?.branches ?? [])
      .filter((b) => ids.has(b.id))
      .map((b) => ({ value: b.id, label: b.name }))
      .sort((a, b) => a.label.localeCompare(b.label, "uk"));
  }, [allEntries, productFilter, countryFilter, managerFilter, branchFilter, distByItem, data]);

  const filtered = useMemo(() => {
    return allEntries.filter((e) => passes(e, null));
  }, [allEntries, productFilter, countryFilter, managerFilter, branchFilter, distByItem]);

  // Group by arrival date (only non-empty)
  const grouped = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of filtered) {
      const iso = (e.sh.arrived_at ?? e.sh.eta)!;
      const arr = m.get(iso) ?? [];
      arr.push(e);
      m.set(iso, arr);
    }
    return Array.from(m.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([iso, entries]) => {
        const [y, mo, da] = iso.split("-").map(Number);
        const date = new Date(y, mo - 1, da);
        return { iso, date, entries };
      });
  }, [filtered]);

  const hasAnyFilter =
    productFilter !== ALL || countryFilter !== ALL || managerFilter !== ALL || branchFilter !== ALL;
  const totalFilteredPallets = useMemo(
    () => filtered.reduce((s, e) => s + getVisiblePallets(e), 0),
    [filtered, branchFilter, distByItem],
  );
  const totalShipments = useMemo(() => {
    const s = new Set<string>();
    for (const e of filtered) s.add(e.sh.id);
    return s.size;
  }, [filtered]);
  const positionsCount = useMemo(() => {
    const keys = new Map<string, string>();
    for (const e of filtered) {
      const product = e.it.product_name.trim();
      const country = (e.it.origin_country ?? "").trim();
      const key = `${product}__${country}`;
      if (!keys.has(key)) keys.set(key, product);
    }
    const groups = Array.from(keys.entries()).map(([, product]) => ({ product }));
    return countPositionsFromGroups(groups, (g) => g.product);
  }, [filtered]);

  return (
    <div className="space-y-4">
      <PageHeader title="Календар" subtitle="Активні поставки за датами прибуття" />

      <div className="rounded-xl border border-border bg-card p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Товар</label>
            <CompactFilterSelect value={productFilter} onChange={setProductFilter} options={productOptions} allLabel="Всі товари" allValue={ALL} aliases={productAliases} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Країна походження</label>
            <CompactFilterSelect value={countryFilter} onChange={setCountryFilter} options={countryOptions} allLabel="Всі країни" allValue={ALL} aliases={countryAliases} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Менеджер</label>
            <CompactFilterSelect value={managerFilter} onChange={setManagerFilter} options={managerOptions} allLabel="Всі менеджери" allValue={ALL} searchable={false} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Філія</label>
            <CompactFilterSelect value={branchFilter} onChange={setBranchFilter} options={branchOptions} allLabel="Всі філії" allValue={ALL} searchable={false} />
          </div>
        </div>
        <div className="flex justify-end">
          <div className="rounded-md bg-destructive/10 px-2 py-1 text-xs text-muted-foreground">
            <span className="font-bold tabular-nums text-foreground">{totalShipments}</span> пост. ·{" "}
            <span className="font-bold tabular-nums text-foreground">{formatPositions(positionsCount)}</span> поз. ·{" "}
            <span className="font-bold tabular-nums text-brand">{totalFilteredPallets}п</span>
          </div>
        </div>
      </div>


      {isLoading ? (
        <p className="text-sm text-muted-foreground">Завантаження…</p>
      ) : grouped.length === 0 ? (
        <EmptyState title="Активних поставок немає" />
      ) : (
        <div className="space-y-3">
          {grouped.map((d) => {
            const totalPallets = d.entries.reduce((s, e) => s + getVisiblePallets(e), 0);
            const headerTitle = `${WEEKDAYS_UK[d.date.getDay()]} · ${d.date.getDate()} ${MONTHS_UK[d.date.getMonth()]}`;
            return (
              <section key={d.iso} className="rounded-2xl border border-border bg-card p-4 shadow-card">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-sky-600 dark:text-sky-300">
                    {headerTitle}
                  </h2>
                  {hasAnyFilter ? (
                    <span className="text-sm font-bold tabular-nums text-brand">{totalPallets}п</span>
                  ) : null}
                </div>
                <ul className="divide-y divide-border">
                  {d.entries.map((e) => {
                    const pallets = getVisiblePallets(e);
                    const rawCountry = e.it.origin_country || "";
                    const countryFull = rawCountry ? toUaCountry(rawCountry) : "";
                    const countryShortRaw = rawCountry ? toShortUaCountry(rawCountry) : "";
                    const caliber = e.it.caliber ?? "";
                    const fullLeftLen = e.it.product_name.length + countryFull.length + caliber.length;
                    const useShortCountry =
                      fullLeftLen > 28 && !!countryShortRaw && countryShortRaw !== countryFull;
                    const country = useShortCountry ? `${countryShortRaw}.` : countryFull;
                    const tailParts: string[] = [];
                    if (country) tailParts.push(country);
                    if (caliber) tailParts.push(caliber);
                    const tail = tailParts.length ? ` · ${tailParts.join(" · ")}` : "";
                    const rawMgr = isStaffAll ? (mgrMap.get(e.sh.import_manager_id ?? "") ?? "") : "";
                    const metaApproxLen =
                      (e.sh.code ? e.sh.code.length : 0) + (rawMgr ? 3 + rawMgr.length : 0);
                    const mgr = rawMgr && metaApproxLen > 34 ? shortenManagerName(rawMgr) : rawMgr;
                    return (
                      <li key={e.key}>
                        <button
                          type="button"
                          onClick={() => setOpenItem({ sh: e.sh, it: e.it })}
                          className="w-full py-2 text-left text-sm active:opacity-70"
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <div className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-sm text-foreground">
                              <span className="font-bold">{e.it.product_name}</span>
                              {tail ? <span>{tail}</span> : null}
                            </div>
                            <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">{pallets}п</span>
                          </div>
                          <div className="mt-0.5 flex items-baseline justify-between gap-2 text-[11px] font-normal text-muted-foreground">
                            <div className="min-w-0 flex-1 overflow-hidden whitespace-nowrap">
                              {e.sh.code ? (
                                <span className="font-mono text-foreground/80">{e.sh.code}</span>
                              ) : null}
                              {mgr ? (
                                <span className="text-foreground/80">{e.sh.code ? " · " : ""}{surname(mgr)}</span>
                              ) : null}
                            </div>
                            <span className="shrink-0">
                              <CostPair indicative={e.it.final_cost_indicative} invoice={e.it.final_cost_invoice} suffix=" кг" size="xs" />
                            </span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {/* Distribution detail dialog */}
      <Dialog open={!!openItem} onOpenChange={(o) => !o && setOpenItem(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">
              {openItem?.it.product_name}
              {openItem?.it.caliber ? <span className="text-muted-foreground"> ·{openItem.it.caliber}</span> : null}
              <div className="mt-0.5 text-xs font-normal text-muted-foreground">
                {openItem?.sh.code} · {openItem?.it.origin_country ?? ""}
                {openItem ? (() => {
                  const mn = mgrMap.get(openItem.sh.import_manager_id ?? "");
                  return mn ? <> · {surname(mn)}</> : null;
                })() : null}
              </div>
            </DialogTitle>
          </DialogHeader>
          {openItem ? (() => {
            const total = Number(openItem.it.pallet_count ?? 0);
            const dist = distByItem.get(openItem.it.id);
            const rows = dist
              ? Array.from(dist.entries())
                  .map(([bid, p]) => ({ branch: brMap.get(bid) ?? "—", pallets: p }))
                  .filter((r) => r.pallets > 0)
                  .sort((a, b) => a.branch.localeCompare(b.branch, "uk"))
              : [];
            const distributed = rows.reduce((a, b) => a + b.pallets, 0);
            const remaining = total - distributed;
            return (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-secondary px-2 py-1.5">
                    <div className="text-[10px] text-muted-foreground">Всього</div>
                    <div className="text-sm font-bold tabular-nums">{total}п</div>
                  </div>
                  <div className="rounded-lg bg-success/15 px-2 py-1.5">
                    <div className="text-[10px] text-success">Розпод.</div>
                    <div className="text-sm font-bold tabular-nums text-success">{distributed}п</div>
                  </div>
                  <div className={`rounded-lg px-2 py-1.5 ${remaining < 0 ? "bg-destructive/15" : "bg-warning/15"}`}>
                    <div className={`text-[10px] ${remaining < 0 ? "text-destructive" : "text-warning"}`}>Залиш.</div>
                    <div className={`text-sm font-bold tabular-nums ${remaining < 0 ? "text-destructive" : "text-warning"}`}>
                      {remaining}п
                    </div>
                  </div>
                </div>

                {rows.length ? (
                  <ul className="divide-y divide-border rounded-xl border border-border">
                    {rows.map((r) => (
                      <li key={r.branch} className="flex items-center justify-between gap-2 px-3 py-2">
                        <span className="truncate text-sm font-medium">{r.branch}</span>
                        <span className="text-sm font-bold tabular-nums text-brand">{r.pallets}п</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title="Ще не розподілено" hint="Усі палети — у залишку." />
                )}

                {isStaffAll && !isReadOnly ? (
                  <Link
                    to="/distribution/$shipmentId"
                    params={{ shipmentId: openItem.sh.id }}
                    onClick={() => setOpenItem(null)}
                    data-mutation
                    className="block w-full rounded-lg bg-brand px-3 py-2.5 text-center text-sm font-semibold text-brand-foreground active:opacity-80"
                  >
                    Розподілити
                  </Link>
                ) : null}
              </div>
            );
          })() : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

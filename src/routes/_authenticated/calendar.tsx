import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { useAuth } from "@/lib/auth";

import { StaffOnly } from "@/components/StaffOnly";
import { CostPair } from "@/components/CostPair";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CompactFilterSelect } from "@/components/CompactFilterSelect";
import { useReadOnly } from "@/components/ReadOnlyShell";
import { useProductAliases } from "@/hooks/useProductAliases";
import { useCountryAliases } from "@/hooks/useCountryAliases";
import { countPositionsFromGroups, formatPositions } from "@/lib/positions";

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

  // Filter options — leave-one-out: each option list reflects the dataset
  // narrowed by all OTHER active filters (AND), so options stay in sync with
  // the current selection without removing the active value itself.
  const productOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of allEntries) {
      if (countryFilter !== ALL) {
        const c = (e.it.origin_country ?? "").trim();
        if (countryFilter === NO_COUNTRY ? c !== "" : c !== countryFilter) continue;
      }
      const name = e.it.product_name.trim();
      if (name) set.add(name);
    }
    if (productFilter !== ALL) set.add(productFilter);
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b, "uk"))
      .map((name) => ({ value: name, label: name }));
  }, [allEntries, countryFilter, productFilter]);

  // Country options: distinct product origin only (NEVER fallback to shipment.country)
  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    let hasMissing = false;
    for (const e of allEntries) {
      if (productFilter !== ALL && e.it.product_name.trim() !== productFilter) continue;
      const c = (e.it.origin_country ?? "").trim();
      if (c) set.add(c);
      else hasMissing = true;
    }
    const arr = Array.from(set)
      .sort((a, b) => a.localeCompare(b, "uk"))
      .map((c) => ({ value: c, label: c }));
    if (hasMissing || countryFilter === NO_COUNTRY) arr.push({ value: NO_COUNTRY, label: NO_COUNTRY_LABEL });
    return arr;
  }, [allEntries, productFilter, countryFilter]);

  const filtered = useMemo(() => {
    return allEntries.filter((e) => {
      if (productFilter !== ALL && e.it.product_name.trim() !== productFilter) return false;
      if (countryFilter !== ALL) {
        const c = (e.it.origin_country ?? "").trim();
        if (countryFilter === NO_COUNTRY ? c !== "" : c !== countryFilter) return false;
      }
      return true;
    });
  }, [allEntries, productFilter, countryFilter]);

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

  const hasAnyFilter = productFilter !== ALL || countryFilter !== ALL;
  const totalFilteredPallets = useMemo(
    () => filtered.reduce((s, e) => s + Number(e.it.pallet_count ?? 0), 0),
    [filtered],
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Календар" subtitle="Активні поставки за датами прибуття" />

      <div className="rounded-xl border border-border bg-card p-3">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Товар</label>
            <CompactFilterSelect
              value={productFilter}
              onChange={setProductFilter}
              options={productOptions}
              allLabel="Всі товари"
              allValue={ALL}
              aliases={productAliases}
            />
          </div>
          <div className="min-w-0 flex-1">
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Країна походження</label>
            <CompactFilterSelect
              value={countryFilter}
              onChange={setCountryFilter}
              options={countryOptions}
              allLabel="Всі країни"
              allValue={ALL}
              aliases={countryAliases}
            />
          </div>
          <span
            className="shrink-0 self-stretch flex items-center rounded-md bg-brand/10 px-2 text-sm font-bold tabular-nums text-brand"
            title="Палет за поточним фільтром"
          >
            {totalFilteredPallets}п
          </span>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Завантаження…</p>
      ) : grouped.length === 0 ? (
        <EmptyState title="Активних поставок немає" />
      ) : (
        <div className="space-y-3">
          {grouped.map((d) => {
            const totalPallets = d.entries.reduce((s, e) => s + Number(e.it.pallet_count ?? 0), 0);
            return (
              <SectionCard
                key={d.iso}
                title={`${WEEKDAYS_UK[d.date.getDay()]} · ${d.date.getDate()} ${MONTHS_UK[d.date.getMonth()]}`}
                action={
                  hasAnyFilter ? (
                    <span className="text-sm font-bold tabular-nums text-brand">{totalPallets}п</span>
                  ) : null
                }
              >
                <ul className="divide-y divide-border">
                  {d.entries.map((e) => {
                    const mgrName = mgrMap.get(e.sh.import_manager_id ?? "");
                    return (
                      <li key={e.key}>
                        <button
                          type="button"
                          onClick={() => setOpenItem({ sh: e.sh, it: e.it })}
                          className="w-full py-2 text-left text-sm active:opacity-70"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs font-bold text-brand">{e.sh.code}</span>
                            <CostPair indicative={e.it.final_cost_indicative} invoice={e.it.final_cost_invoice} suffix=" кг" size="xs" />
                          </div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            <span className="font-medium text-foreground">{e.it.product_name}</span>
                            {e.it.origin_country ? (
                              <span> · {e.it.origin_country}</span>
                            ) : null}
                            <span> · <span className="font-bold tabular-nums text-brand">{Number(e.it.pallet_count ?? 0)}п</span></span>
                            {isStaffAll && mgrName ? (
                              <span> · <span className="text-foreground">{surname(mgrName)}</span></span>
                            ) : null}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </SectionCard>
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

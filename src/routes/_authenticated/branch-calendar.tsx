import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { EmptyState } from "@/components/cards";
import { useAuth } from "@/lib/auth";
import { CostPair } from "@/components/CostPair";
import { CompactFilterSelect } from "@/components/CompactFilterSelect";
import { ShinyFilterSelect } from "@/components/ShinyFilterSelect";

const MALEKHIV_BRANCH_ID = "3bb65cb3-27a1-5f18-839a-340271d711fd";
import { MalekhivBranchCalendarList } from "@/components/malekhiv/MalekhivBranchCalendarList";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useProductAliases } from "@/hooks/useProductAliases";
import { useCountryAliases } from "@/hooks/useCountryAliases";
import { countPositionsFromGroups, formatPositions } from "@/lib/positions";
import { toUaCountry, toShortUaCountry } from "@/lib/countries";

// Abbreviate manager name when row is tight. Mirrors branch "Головна".
const shortenManagerName = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0]} ${parts[1].charAt(0)}.`;
};

export const Route = createFileRoute("/_authenticated/branch-calendar")({
  component: BranchCalendarPage,
});

const ALL = "__all";
const NO_COUNTRY = "__no_country__";
const NO_COUNTRY_LABEL = "— Без країни";

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

type Dist = {
  id: string;
  shipment_id: string;
  distribution_items: Array<{
    pallets: number | null;
    shipment_item_id: string | null;
  }> | null;
};

type Item = {
  id: string;
  product_name: string;
  origin_country: string | null;
  variety: string | null;
  brand: string | null;
  class: string | null;
  caliber: string | null;
  pallet_weight: number | null;
  final_cost_indicative: number | null;
  final_cost_invoice: number | null;
};

type Ship = {
  id: string;
  code: string;
  eta: string | null;
  arrived_at: string | null;
  country: string | null;
  import_manager_name: string | null;
};

type Entry = { ship: Ship; item: Item; pallets: number; arrival: string; key: string };

function BranchCalendarPage() {
  const { profile } = useAuth();
  const branchId = profile?.branch_id;
  const productAliases = useProductAliases();
  const countryAliases = useCountryAliases();
  const [productFilter, setProductFilter] = useState<string>(ALL);
  const [countryFilter, setCountryFilter] = useState<string>(ALL);
  const [openEntry, setOpenEntry] = useState<Entry | null>(null);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const fromISO = isoDate(today);

  const { data: dists, isLoading } = useQuery({
    queryKey: ["branch-cal-dists", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributions")
        .select("id,shipment_id,distribution_items(pallets,shipment_item_id)")
        .eq("branch_id", branchId!);
      if (error) throw error;
      return (data ?? []) as Dist[];
    },
  });

  const itemIds = useMemo(
    () => Array.from(new Set((dists ?? []).flatMap((d) => (d.distribution_items ?? []).map((di) => di.shipment_item_id).filter(Boolean) as string[]))),
    [dists],
  );
  const shipmentIds = useMemo(
    () => Array.from(new Set((dists ?? []).map((d) => d.shipment_id).filter(Boolean))),
    [dists],
  );

  const { data: items } = useQuery({
    queryKey: ["branch-cal-items", itemIds.join(",")],
    enabled: itemIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("shipment_items_branch")
        .select("id,product_name,origin_country,variety,brand,class,caliber,pallet_weight,final_cost_indicative,final_cost_invoice")
        .in("id", itemIds);
      if (error) throw error;
      return (data ?? []) as Item[];
    },
  });

  const { data: ships } = useQuery({
    queryKey: ["branch-cal-ships", shipmentIds.join(",")],
    enabled: shipmentIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("shipments_branch")
        .select("id,code,eta,arrived_at,country,import_manager_name")
        .in("id", shipmentIds);
      if (error) throw error;
      return (data ?? []) as Ship[];
    },
  });


  const allEntries: Entry[] = useMemo(() => {
    if (!dists || !items || !ships) return [];
    const itemMap = new Map(items.map((i) => [i.id, i]));
    const shipMap = new Map(ships.map((s) => [s.id, s]));
    const merged = new Map<string, Entry>();
    for (const d of dists) {
      const sh = shipMap.get(d.shipment_id);
      if (!sh) continue;
      const arrival = sh.arrived_at ?? sh.eta;
      if (!arrival || arrival < fromISO) continue;
      for (const di of d.distribution_items ?? []) {
        const pallets = Number(di.pallets ?? 0);
        if (pallets <= 0 || !di.shipment_item_id) continue;
        const it = itemMap.get(di.shipment_item_id);
        if (!it) continue;
        const key = `${arrival}__${sh.id}__${it.id}`;
        const prev = merged.get(key);
        if (prev) {
          prev.pallets += pallets;
        } else {
          merged.set(key, { ship: sh, item: it, pallets, arrival, key });
        }
      }
    }
    return Array.from(merged.values());
  }, [dists, items, ships, fromISO]);

  const passes = (e: Entry, excl: "product" | "country" | null) => {
    if (excl !== "product" && productFilter !== ALL && e.item.product_name.trim() !== productFilter) return false;
    if (excl !== "country" && countryFilter !== ALL) {
      const c = (e.item.origin_country ?? "").trim();
      if (countryFilter === NO_COUNTRY ? c !== "" : c !== countryFilter) return false;
    }
    return true;
  };

  const productOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of allEntries) {
      if (!passes(e, "product")) continue;
      const name = e.item.product_name.trim();
      if (name) set.add(name);
    }
    if (productFilter !== ALL) set.add(productFilter);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "uk")).map((n) => ({ value: n, label: n }));
  }, [allEntries, countryFilter, productFilter]);

  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    let hasMissing = false;
    for (const e of allEntries) {
      if (!passes(e, "country")) continue;
      const c = (e.item.origin_country ?? "").trim();
      if (c) set.add(c);
      else hasMissing = true;
    }
    const arr = Array.from(set).sort((a, b) => a.localeCompare(b, "uk")).map((c) => ({ value: c, label: c }));
    if (hasMissing || countryFilter === NO_COUNTRY) arr.push({ value: NO_COUNTRY, label: NO_COUNTRY_LABEL });
    return arr;
  }, [allEntries, productFilter, countryFilter]);

  const filtered = useMemo(() => allEntries.filter((e) => passes(e, null)), [allEntries, productFilter, countryFilter]);

  const grouped = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of filtered) {
      const arr = m.get(e.arrival) ?? [];
      arr.push(e);
      m.set(e.arrival, arr);
    }
    return Array.from(m.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([iso, entries]) => {
        const [y, mo, da] = iso.split("-").map(Number);
        return { iso, date: new Date(y, mo - 1, da), entries };
      });
  }, [filtered]);

  const hasAnyFilter = productFilter !== ALL || countryFilter !== ALL;
  const totalPallets = useMemo(() => filtered.reduce((s, e) => s + e.pallets, 0), [filtered]);
  const totalShipments = useMemo(() => new Set(filtered.map((e) => e.ship.id)).size, [filtered]);
  const positionsCount = useMemo(() => {
    const keys = new Map<string, string>();
    for (const e of filtered) {
      const product = e.item.product_name.trim();
      const country = (e.item.origin_country ?? "").trim();
      const key = `${product}__${country}`;
      if (!keys.has(key)) keys.set(key, product);
    }
    const groups = Array.from(keys.entries()).map(([, product]) => ({ product }));
    return countPositionsFromGroups(groups, (g) => g.product);
  }, [filtered]);

  return (
    <div className="space-y-4">
      <PageHeader title="Календар" />

      <div className="rounded-xl border border-border bg-card p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Товар</label>
            {branchId === MALEKHIV_BRANCH_ID ? (
              <ShinyFilterSelect value={productFilter} onChange={setProductFilter} options={productOptions} allLabel="Всі товари" allValue={ALL} />
            ) : (
              <CompactFilterSelect value={productFilter} onChange={setProductFilter} options={productOptions} allLabel="Всі товари" allValue={ALL} aliases={productAliases} />
            )}
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Країна походження</label>
            {branchId === MALEKHIV_BRANCH_ID ? (
              <ShinyFilterSelect value={countryFilter} onChange={setCountryFilter} options={countryOptions} allLabel="Всі країни" allValue={ALL} />
            ) : (
              <CompactFilterSelect value={countryFilter} onChange={setCountryFilter} options={countryOptions} allLabel="Всі країни" allValue={ALL} aliases={countryAliases} />
            )}
          </div>
        </div>
        <div className="flex justify-end">
          <div className="rounded-md bg-destructive/10 px-2 py-1 text-xs text-muted-foreground">
            <span className="font-bold tabular-nums text-foreground">{totalShipments}</span> пост. ·{" "}
            <span className="font-bold tabular-nums text-foreground">{formatPositions(positionsCount)}</span> поз. ·{" "}
            <span className="font-bold tabular-nums text-brand">{totalPallets}п</span>
          </div>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Завантаження…</p>
      ) : grouped.length === 0 ? (
        <EmptyState title="Активних поставок немає" />
      ) : branchId === MALEKHIV_BRANCH_ID ? (
        // Malekhiv-only: L1/L2 render via MobileGlassTable per day. Only
        // branch-specific allocated quantity/weight is displayed (no roll-up).
        <MalekhivBranchCalendarList grouped={grouped} />
      ) : (
        <div className="space-y-3">
          {grouped.map((d) => {
            const dayPallets = d.entries.reduce((s, e) => s + e.pallets, 0);
            const headerTitle = `${WEEKDAYS_UK[d.date.getDay()]} · ${d.date.getDate()} ${MONTHS_UK[d.date.getMonth()]}`;
            return (
              // Inlined SectionCard markup so only the date header text color
              // changes (sky like "Головна" ETA). All other classes — section
              // wrapper, header layout, h2 font/size/weight/tracking/spacing —
              // copied verbatim from SectionCard.
              <section key={d.iso} className="rounded-2xl border border-border bg-card p-4 shadow-card">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-sky-600 dark:text-sky-300">
                    {headerTitle}
                  </h2>
                  {hasAnyFilter ? (
                    <span className="text-sm font-bold tabular-nums text-brand">{dayPallets}п</span>
                  ) : null}
                </div>
                <ul className="divide-y divide-border" data-malekhiv-card={branchId === MALEKHIV_BRANCH_ID ? "" : undefined}>
                  {d.entries.map((e) => {
                    const rawCountry = e.item.origin_country || e.ship.country || "";
                    const countryFull = rawCountry ? toUaCountry(rawCountry) : "";
                    const countryShortRaw = rawCountry ? toShortUaCountry(rawCountry) : "";
                    const variety = e.item.variety ?? "";
                    const fullLeftLen = e.item.product_name.length + countryFull.length + variety.length;
                    const useShortCountry =
                      fullLeftLen > 28 && !!countryShortRaw && countryShortRaw !== countryFull;
                    const country = useShortCountry ? `${countryShortRaw}.` : countryFull;
                    const tailParts: string[] = [];
                    if (country) tailParts.push(country);
                    if (variety) tailParts.push(variety);
                    const tail = tailParts.length ? ` · ${tailParts.join(" · ")}` : "";
                    const rawMgr = e.ship.import_manager_name ?? "";
                    const metaApproxLen =
                      (e.ship.code ? e.ship.code.length : 0) + (rawMgr ? 3 + rawMgr.length : 0);
                    const mgr = rawMgr && metaApproxLen > 34 ? shortenManagerName(rawMgr) : rawMgr;
                    return (
                      <li key={e.key}>
                        <button
                          type="button"
                          onClick={() => setOpenEntry(e)}
                          className="m-row w-full py-2 text-left text-sm active:opacity-70"
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <div className="m-main min-w-0 flex-1 overflow-hidden whitespace-nowrap text-sm text-foreground">
                              <span className="font-bold">{e.item.product_name}</span>
                              {tail ? <span>{tail}</span> : null}
                            </div>
                            <span className="m-pal shrink-0 text-sm font-bold tabular-nums text-foreground">{e.pallets}п</span>
                          </div>
                          <div className="m-meta mt-0.5 flex items-baseline justify-between gap-2 text-[11px] font-normal text-muted-foreground">
                            <div className="min-w-0 flex-1 overflow-hidden whitespace-nowrap">
                              {e.ship.code ? (
                                <span className="font-mono text-foreground/80">{e.ship.code}</span>
                              ) : null}
                              {mgr ? (
                                <span className="text-foreground/80">{e.ship.code ? " · " : ""}{mgr}</span>
                              ) : null}
                            </div>
                            <span className="shrink-0">
                              <CostPair indicative={e.item.final_cost_indicative} invoice={e.item.final_cost_invoice} suffix=" кг" size="xs" />
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

      <Dialog open={!!openEntry} onOpenChange={(o) => !o && setOpenEntry(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          {openEntry ? (() => {
            const e = openEntry;
            const country = e.item.origin_country || e.ship.country || "";
            const eta = e.ship.arrived_at ?? e.ship.eta;
            const weight = Number(e.item.pallet_weight ?? 0) * e.pallets;
            const extras: Array<{ label: string; value: string }> = [];
            if (e.item.variety) extras.push({ label: "Сорт", value: e.item.variety });
            if (e.item.caliber) extras.push({ label: "Калібр", value: e.item.caliber });
            if (e.item.brand) extras.push({ label: "Бренд", value: e.item.brand });
            if (e.item.class) extras.push({ label: "Клас", value: e.item.class });
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="text-base">
                    {e.item.product_name}
                    {country ? <span> · {country}</span> : null}
                    {e.item.variety ? <span className="font-normal text-muted-foreground"> · {e.item.variety}</span> : null}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-secondary px-2 py-1.5">
                      <div className="text-[10px] text-info">ETA</div>
                      <div className="text-sm font-bold tabular-nums text-info">{eta ?? "—"}</div>
                      <div className="mt-1 text-[11px] font-mono text-muted-foreground">{e.ship.code}</div>
                    </div>
                    <div className="rounded-lg bg-secondary px-2 py-1.5 text-right">
                      <div className="text-[10px] text-muted-foreground">Палети</div>
                      <div className="text-sm font-bold tabular-nums text-brand">{e.pallets}п</div>
                      {weight > 0 ? (
                        <div className="mt-1 text-[11px] tabular-nums text-muted-foreground">{weight.toFixed(0)} кг</div>
                      ) : null}
                    </div>
                  </div>

                  {extras.length ? (
                    <ul className="space-y-1 rounded-xl border border-border px-3 py-2 text-xs">
                      {extras.map((x) => (
                        <li key={x.label} className="flex justify-between gap-2">
                          <span className="text-muted-foreground">{x.label}:</span>
                          <span className="font-medium text-foreground">{x.value}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {(e.item.final_cost_indicative != null || e.item.final_cost_invoice != null) ? (
                    <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-xs">
                      <span className="text-muted-foreground">Собівартість</span>
                      <CostPair indicative={e.item.final_cost_indicative} invoice={e.item.final_cost_invoice} suffix=" кг" size="sm" />
                    </div>
                  ) : null}

                  {e.ship.import_manager_name ? (
                    <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-xs">
                      <span className="text-muted-foreground">Менеджер</span>
                      <span className="font-medium text-foreground">{e.ship.import_manager_name}</span>
                    </div>
                  ) : null}
                </div>
              </>
            );
          })() : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { useAuth } from "@/lib/auth";
import { CostPair } from "@/components/CostPair";

export const Route = createFileRoute("/_authenticated/branch-calendar")({
  component: BranchCalendarPage,
});

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

function BranchCalendarPage() {
  const { profile } = useAuth();
  const branchId = profile?.branch_id;
  const [productFilter, setProductFilter] = useState<string>("__all");

  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffISO = isoDate(cutoff);

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
        .select("id,product_name,origin_country,final_cost_indicative,final_cost_invoice")
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

  type Entry = { ship: Ship; item: Item; pallets: number; arrival: string; key: string };

  const allEntries: Entry[] = useMemo(() => {
    if (!dists || !items || !ships) return [];
    const itemMap = new Map(items.map((i) => [i.id, i]));
    const shipMap = new Map(ships.map((s) => [s.id, s]));
    const merged = new Map<string, Entry>();
    for (const d of dists) {
      const sh = shipMap.get(d.shipment_id);
      if (!sh) continue;
      const arrival = sh.arrived_at ?? sh.eta;
      if (!arrival || arrival < cutoffISO) continue;
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
  }, [dists, items, ships, cutoffISO]);

  const productOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of allEntries) {
      const country = e.item.origin_country || e.ship.country || "";
      set.add(`${e.item.product_name.trim()}__${country}`);
    }
    return Array.from(set)
      .map((k) => {
        const [name, country] = k.split("__");
        return { key: k, name, country };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "uk"));
  }, [allEntries]);

  const filtered = useMemo(() => {
    if (productFilter === "__all") return allEntries;
    return allEntries.filter((e) => {
      const country = e.item.origin_country || e.ship.country || "";
      return `${e.item.product_name.trim()}__${country}` === productFilter;
    });
  }, [allEntries, productFilter]);

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

  const isProductView = productFilter !== "__all";

  return (
    <div className="space-y-4">
      <PageHeader title="Календар" subtitle="Активний товар вашої філії за датами прибуття" />

      <div className="rounded-xl border border-border bg-card p-3">
        <label className="mb-1 block text-xs font-semibold text-muted-foreground">Товар</label>
        <select
          value={productFilter}
          onChange={(e) => setProductFilter(e.target.value)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="__all">Всі активні товари</option>
          {productOptions.map((p) => (
            <option key={p.key} value={p.key}>
              {p.name}{p.country ? ` • ${p.country}` : ""}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Завантаження…</p>
      ) : grouped.length === 0 ? (
        <EmptyState title="Активних поставок немає" />
      ) : (
        <div className="space-y-3">
          {grouped.map((d) => {
            const totalPallets = d.entries.reduce((s, e) => s + e.pallets, 0);
            return (
              <SectionCard
                key={d.iso}
                title={`${WEEKDAYS_UK[d.date.getDay()]} · ${d.date.getDate()} ${MONTHS_UK[d.date.getMonth()]}`}
                action={isProductView ? (
                  <span className="text-sm font-bold tabular-nums text-brand">{totalPallets}п</span>
                ) : null}
              >
                <ul className="divide-y divide-border">
                  {d.entries.map((e) => (
                    <li key={e.key} className="py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs">
                          <span className="font-mono font-bold text-brand">{e.ship.code}</span>
                          <span className="font-normal text-muted-foreground"> ({e.ship.import_manager_name || "—"})</span>
                        </span>
                        <CostPair indicative={e.item.final_cost_indicative} invoice={e.item.final_cost_invoice} suffix=" кг" size="xs" />
                      </div>
                      <div className="mt-0.5 text-muted-foreground">
                        <span className="font-medium text-foreground">{e.item.product_name}</span>
                        {(e.item.origin_country || e.ship.country) ? (
                          <span> · {e.item.origin_country || e.ship.country}</span>
                        ) : null}
                        <span> · <span className="font-bold tabular-nums text-brand">{e.pallets}п</span></span>
                      </div>
                    </li>
                  ))}
                </ul>
              </SectionCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

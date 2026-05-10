import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { useAuth } from "@/lib/auth";

import { StaffOnly } from "@/components/StaffOnly";
import { CostPair } from "@/components/CostPair";

export const Route = createFileRoute("/_authenticated/calendar")({
  component: () => <StaffOnly><CalendarPage /></StaffOnly>,
});

type ShipmentRow = {
  id: string;
  code: string;
  country: string | null;
  eta: string | null;
  arrived_at: string | null;
  import_manager_id: string | null;
  shipment_items: Array<{
    id: string;
    product_name: string;
    origin_country: string | null;
    unit_price: number | null;
    price_currency: string | null;
    pallet_count: number | null;
  }>;
};

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

function fmtPrice(v: number | null | undefined, cur: string | null | undefined) {
  if (v == null || isNaN(Number(v))) return "—";
  const symbol = cur === "USD" ? "$" : cur === "EUR" ? "€" : (cur || "");
  return `${symbol}${Number(v).toFixed(2)}`;
}

function CalendarPage() {
  const { user, hasRole } = useAuth();
  const isStaffAll = hasRole(["admin", "super_admin"]);
  const [productFilter, setProductFilter] = useState<string>("__all");

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const fromISO = isoDate(today);

  const { data, isLoading } = useQuery({
    queryKey: ["calendar-shipments", user?.id, isStaffAll, fromISO],
    enabled: !!user,
    queryFn: async () => {
      let q = supabase
        .from("shipments")
        .select(
          "id,code,country,eta,arrived_at,import_manager_id, shipment_items(id,product_name,origin_country,unit_price,price_currency,pallet_count)",
        );
      if (!isStaffAll) q = q.eq("import_manager_id", user!.id);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ShipmentRow[];
    },
  });

  // Build per-date entries (only future/today, only with items having pallets > 0)
  type Entry = { sh: ShipmentRow; it: ShipmentRow["shipment_items"][number]; key: string };

  const allEntries: Entry[] = useMemo(() => {
    const out: Entry[] = [];
    for (const sh of data ?? []) {
      const arrival = sh.arrived_at ?? sh.eta;
      if (!arrival || arrival < fromISO) continue;
      for (const it of sh.shipment_items ?? []) {
        if (Number(it.pallet_count ?? 0) <= 0) continue;
        out.push({ sh, it, key: `${arrival}__${sh.id}__${it.id}` });
      }
    }
    return out;
  }, [data, fromISO]);

  // Active products list (only those with at least 1 pallet active)
  const productOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of allEntries) {
      const country = e.it.origin_country || e.sh.country || "";
      set.add(`${e.it.product_name.trim()}__${country}`);
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
      const country = e.it.origin_country || e.sh.country || "";
      return `${e.it.product_name.trim()}__${country}` === productFilter;
    });
  }, [allEntries, productFilter]);

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

  const isProductView = productFilter !== "__all";

  return (
    <div className="space-y-4">
      <PageHeader title="Календар" subtitle="Активні поставки за датами прибуття" />

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
            const totalPallets = d.entries.reduce((s, e) => s + Number(e.it.pallet_count ?? 0), 0);
            return (
              <SectionCard
                key={d.iso}
                title={`${WEEKDAYS_UK[d.date.getDay()]} · ${d.date.getDate()} ${MONTHS_UK[d.date.getMonth()]}`}
                action={
                  isProductView ? (
                    <span className="text-sm font-bold tabular-nums text-brand">{totalPallets}п</span>
                  ) : null
                }
              >
                <ul className="divide-y divide-border">
                  {d.entries.map((e) => (
                    <li key={e.key} className="py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-bold text-brand">{e.sh.code}</span>
                        <span className="font-bold tabular-nums">
                          {fmtPrice(e.it.unit_price, e.it.price_currency)}
                        </span>
                      </div>
                      <div className="mt-0.5 text-muted-foreground">
                        <span className="font-medium text-foreground">{e.it.product_name}</span>
                        {(e.it.origin_country || e.sh.country) ? (
                          <span> · {e.it.origin_country || e.sh.country}</span>
                        ) : null}
                        <span> · <span className="font-bold tabular-nums text-brand">{Number(e.it.pallet_count ?? 0)}п</span></span>
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

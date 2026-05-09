import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/calendar")({
  component: CalendarPage,
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
  // Local YYYY-MM-DD (avoid UTC shift in toISOString)
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

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 9);

  const fromISO = isoDate(today);
  const toISO = isoDate(endDate);

  const { data, isLoading } = useQuery({
    queryKey: ["calendar-shipments", user?.id, isStaffAll, fromISO, toISO],
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

  // group shipments by arrival date (arrived_at fallback eta)
  const byDate = new Map<string, ShipmentRow[]>();
  for (const sh of data ?? []) {
    const arrival = sh.arrived_at ?? sh.eta;
    if (!arrival) continue;
    if (arrival < fromISO || arrival > toISO) continue;
    const arr = byDate.get(arrival) ?? [];
    arr.push(sh);
    byDate.set(arrival, arr);
  }

  const days: Array<{ iso: string; date: Date; shipments: ShipmentRow[] }> = [];
  for (let i = 0; i < 10; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const iso = isoDate(d);
    days.push({ iso, date: d, shipments: byDate.get(iso) ?? [] });
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Календар" subtitle="Поставки на найближчі 10 днів" />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Завантаження…</p>
      ) : (
        <div className="space-y-3">
          {days.map((d) => (
            <SectionCard
              key={d.iso}
              title={`${WEEKDAYS_UK[d.date.getDay()]} · ${d.date.getDate()} ${MONTHS_UK[d.date.getMonth()]}`}
            >
              {d.shipments.length === 0 ? (
                <EmptyState title="Поставок немає" />
              ) : (
                <ul className="divide-y divide-border">
                  {d.shipments.flatMap((sh) =>
                    (sh.shipment_items ?? []).map((it) => (
                      <li key={`${sh.id}__${it.id}`} className="py-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-bold text-brand">{sh.code}</span>
                          <span className="font-bold tabular-nums">
                            {fmtPrice(it.unit_price, it.price_currency)}
                          </span>
                        </div>
                        <div className="mt-0.5 text-muted-foreground">
                          <span className="font-medium text-foreground">{it.product_name}</span>
                          {(it.origin_country || sh.country) ? (
                            <span> · {it.origin_country || sh.country}</span>
                          ) : null}
                        </div>
                      </li>
                    )),
                  )}
                  {d.shipments.every((s) => !(s.shipment_items ?? []).length) && (
                    <li className="py-2 text-xs text-muted-foreground">Без позицій</li>
                  )}
                </ul>
              )}
            </SectionCard>
          ))}
        </div>
      )}
    </div>
  );
}

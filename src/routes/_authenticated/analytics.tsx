import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/analytics")({
  component: Analytics,
});

type ShipmentRow = {
  id: string;
  country: string | null;
  eta: string | null;
  arrived_at: string | null;
  import_manager_id: string | null;
  shipment_items: Array<{
    id: string;
    product_name: string;
    origin_country: string | null;
    pallet_count: number | null;
  }>;
};

function todayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function Analytics() {
  const { user, hasRole } = useAuth();
  const isStaffAll = hasRole(["admin", "super_admin"]);

  const { data, isLoading } = useQuery({
    queryKey: ["analytics-product-country", user?.id, isStaffAll],
    enabled: !!user,
    queryFn: async () => {
      let q = supabase
        .from("shipments")
        .select(
          "id,country,eta,arrived_at,import_manager_id, shipment_items(id,product_name,origin_country,pallet_count)",
        )
        .order("created_at", { ascending: false })
        .limit(500);
      if (!isStaffAll) q = q.eq("import_manager_id", user!.id);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ShipmentRow[];
    },
  });

  const today = todayISO();
  const groups = new Map<string, { product: string; country: string; pallets: number }>();

  for (const sh of data ?? []) {
    // Disappear the day AFTER arrival: include while today <= arrival date.
    const arrival = sh.arrived_at ?? sh.eta;
    if (arrival && arrival < today) continue;
    for (const it of sh.shipment_items ?? []) {
      const product = (it.product_name || "").trim();
      const country = (it.origin_country || sh.country || "").trim();
      const pallets = Number(it.pallet_count ?? 0);
      if (!product || pallets <= 0) continue;
      const key = `${product}__${country}`;
      const cur = groups.get(key) ?? { product, country, pallets: 0 };
      cur.pallets += pallets;
      groups.set(key, cur);
    }
  }

  const rows = Array.from(groups.values()).sort(
    (a, b) => a.product.localeCompare(b.product, "uk") || a.country.localeCompare(b.country, "uk"),
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Аналітика" subtitle="Активні товари у поставках (палети)" />

      <SectionCard title="Товар · країна · кількість">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Завантаження…</p>
        ) : !rows.length ? (
          <EmptyState title="Немає активних товарів" description="Тут зʼявляться товари ваших поставок до наступного дня після прибуття." />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={`${r.product}__${r.country}`} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0 text-sm">
                  <span className="font-medium">{r.product}</span>
                  {r.country ? <span className="text-muted-foreground"> · {r.country}</span> : null}
                </div>
                <div className="shrink-0 text-sm font-bold tabular-nums text-brand">{r.pallets}п</div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

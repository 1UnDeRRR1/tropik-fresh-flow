import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus, Package, Truck, AlertTriangle, MailQuestion, History, CalendarClock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { StatCard, SectionCard, EmptyState } from "@/components/cards";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/dashboard/manager")({
  component: ManagerDashboard,
});

const ACTIVE = ["draft", "loading", "in_transit", "customs", "arrived", "distributing", "delayed"];

function ManagerDashboard() {
  const { data } = useQuery({
    queryKey: ["dash-manager"],
    queryFn: async () => {
      const today = new Date();
      const weekEnd = new Date();
      weekEnd.setDate(today.getDate() + 7);
      const isoToday = today.toISOString().slice(0, 10);
      const isoWeek = weekEnd.toISOString().slice(0, 10);

      const [shipments, requests, changes] = await Promise.all([
        supabase
          .from("shipments")
          .select("id,code,status,eta,country,suppliers(name,country),shipment_items(pallet_count),distributions(distribution_items(pallets))")
          .order("created_at", { ascending: false })
          .limit(80),
        supabase
          .from("branch_requests")
          .select("id,status")
          .eq("status", "pending"),
        supabase
          .from("shipment_item_changes")
          .select("id,field,old_value,new_value,created_at,shipment_id")
          .order("created_at", { ascending: false })
          .limit(8),
      ]);

      const ships = shipments.data ?? [];
      const active = ships.filter((s) => ACTIVE.includes(s.status));
      const arrivingWeek = ships.filter(
        (s) => s.eta && s.eta >= isoToday && s.eta <= isoWeek && !["completed", "cancelled"].includes(s.status),
      );
      const delayed = ships.filter((s) => s.status === "delayed" || (s.eta && s.eta < isoToday && !["completed", "cancelled", "distributing"].includes(s.status)));
      const notDistributed = ships.filter((s) => {
        const fact = (s.shipment_items ?? []).reduce((a: number, it: { pallet_count: number | null }) => a + Number(it.pallet_count ?? 0), 0);
        const dist = (s.distributions ?? []).reduce(
          (a: number, d: { distribution_items: { pallets: number | null }[] | null }) =>
            a + (d.distribution_items ?? []).reduce((aa, di) => aa + Number(di.pallets ?? 0), 0),
          0,
        );
        return fact > 0 && dist < fact && !["completed", "cancelled"].includes(s.status);
      });

      return {
        active: active.length,
        arrivingWeek: arrivingWeek.length,
        notDistributed: notDistributed.length,
        delayed: delayed.length,
        requests: requests.data?.length ?? 0,
        changes: changes.data ?? [],
        recent: ships.slice(0, 6),
      };
    },
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Менеджер імпорту"
        subtitle="Операційний центр"
        action={
          <Link to="/shipments/new">
            <Button size="sm" className="bg-brand text-brand-foreground hover:bg-brand/90">
              <Plus className="mr-1 h-4 w-4" /> Поставка
            </Button>
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Активні" value={data?.active ?? 0} icon={<Package className="h-4 w-4" />} tone="primary" to="/shipments" />
        <StatCard label="Прибуває за тиждень" value={data?.arrivingWeek ?? 0} icon={<CalendarClock className="h-4 w-4" />} tone="brand" />
        <StatCard label="Не розподілено" value={data?.notDistributed ?? 0} icon={<Truck className="h-4 w-4" />} />
        <StatCard label="Затримки" value={data?.delayed ?? 0} icon={<AlertTriangle className="h-4 w-4" />} />
        <StatCard label="Заявки філій" value={data?.requests ?? 0} icon={<MailQuestion className="h-4 w-4" />} to="/branch-requests" />
        <StatCard label="Зміни" value={data?.changes.length ?? 0} icon={<History className="h-4 w-4" />} />
      </div>

      <SectionCard
        title="Останні поставки"
        action={<Link to="/shipments" className="text-xs font-medium text-brand">Усі</Link>}
      >
        {!data?.recent.length ? (
          <EmptyState title="Поставок ще немає" hint="Натисніть «Поставка», щоб створити першу" />
        ) : (
          <ul className="divide-y divide-border">
            {data.recent.map((s) => (
              <li key={s.id}>
                <Link to="/shipments/$id" params={{ id: s.id }} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{s.code}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {s.suppliers?.name ?? "—"} · {s.country ?? s.suppliers?.country ?? ""}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatusChip status={s.status} />
                    <span className="text-[10px] text-muted-foreground">ETA {s.eta ?? "—"}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Останні зміни">
        {!data?.changes.length ? (
          <EmptyState title="Змін немає" />
        ) : (
          <ul className="divide-y divide-border text-xs">
            {data.changes.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2">
                <span className="font-medium">{c.field}</span>
                <span className="text-muted-foreground">
                  {c.old_value ?? "—"} → <span className="text-brand font-semibold">{c.new_value ?? "—"}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

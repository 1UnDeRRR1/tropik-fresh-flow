import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus, Package, Truck, Clock, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { StatCard, SectionCard, EmptyState } from "@/components/cards";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/dashboard/manager")({
  component: ManagerDashboard,
});

function ManagerDashboard() {
  const { data: shipments } = useQuery({
    queryKey: ["dash-shipments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shipments")
        .select("id,code,status,eta,supplier_id, suppliers(name,country)")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const counts = {
    active: shipments?.filter((s) => !["completed", "cancelled"].includes(s.status)).length ?? 0,
    transit: shipments?.filter((s) => s.status === "in_transit").length ?? 0,
    customs: shipments?.filter((s) => s.status === "customs").length ?? 0,
    arrived: shipments?.filter((s) => s.status === "arrived").length ?? 0,
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Менеджер імпорту"
        subtitle="Огляд активних поставок"
        action={
          <Link to="/shipments/new">
            <Button size="sm" className="bg-brand text-brand-foreground hover:bg-brand/90">
              <Plus className="mr-1 h-4 w-4" /> Поставка
            </Button>
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Активні" value={counts.active} icon={<Package className="h-4 w-4" />} tone="primary" />
        <StatCard label="У дорозі" value={counts.transit} icon={<Truck className="h-4 w-4" />} />
        <StatCard label="Митниця" value={counts.customs} icon={<Clock className="h-4 w-4" />} />
        <StatCard label="Прибуло" value={counts.arrived} icon={<CheckCircle2 className="h-4 w-4" />} tone="brand" />
      </div>

      <SectionCard
        title="Останні поставки"
        action={
          <Link to="/shipments" className="text-xs font-medium text-brand">
            Усі
          </Link>
        }
      >
        {!shipments?.length ? (
          <EmptyState title="Поставок ще немає" hint="Натисніть «Поставка», щоб створити першу" />
        ) : (
          <ul className="divide-y divide-border">
            {shipments.slice(0, 6).map((s) => (
              <li key={s.id}>
                <Link
                  to="/shipments/$id"
                  params={{ id: s.id }}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{s.code}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {s.suppliers?.name ?? "—"} · {s.suppliers?.country ?? ""}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatusChip status={s.status} />
                    <span className="text-[10px] text-muted-foreground">
                      ETA {s.eta ?? "—"}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <div className="grid grid-cols-2 gap-3">
        <Link
          to="/suppliers"
          className="rounded-2xl border border-border bg-card p-4 shadow-card active:scale-[0.98]"
        >
          <div className="text-sm font-semibold">Постачальники</div>
          <div className="mt-1 text-xs text-muted-foreground">База контрагентів</div>
        </Link>
        <Link
          to="/costs"
          className="rounded-2xl border border-border bg-card p-4 shadow-card active:scale-[0.98]"
        >
          <div className="text-sm font-semibold">Собівартість</div>
          <div className="mt-1 text-xs text-muted-foreground">Калькуляція позицій</div>
        </Link>
      </div>
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Users, Building2, Package, BarChart3 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { StatCard, SectionCard, EmptyState } from "@/components/cards";

export const Route = createFileRoute("/_authenticated/dashboard/admin")({
  component: AdminDashboard,
});

function AdminDashboard() {
  const { data } = useQuery({
    queryKey: ["admin-overview"],
    queryFn: async () => {
      const [shipments, branches, suppliers, profiles] = await Promise.all([
        supabase.from("shipments").select("id,status", { count: "exact" }),
        supabase.from("branches").select("id", { count: "exact", head: true }),
        supabase.from("suppliers").select("id", { count: "exact", head: true }),
        supabase.from("profiles").select("id,full_name,branch_id").limit(8),
      ]);
      return {
        shipmentCount: shipments.count ?? 0,
        active:
          shipments.data?.filter((s) => !["completed", "cancelled"].includes(s.status)).length ?? 0,
        branchCount: branches.count ?? 0,
        supplierCount: suppliers.count ?? 0,
        profiles: profiles.data ?? [],
      };
    },
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Адміністратор" subtitle="Загальний стан системи" />

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Поставок усього" value={data?.shipmentCount ?? 0} icon={<Package className="h-4 w-4" />} tone="primary" />
        <StatCard label="Активних" value={data?.active ?? 0} tone="brand" />
        <StatCard label="Філій" value={data?.branchCount ?? 0} icon={<Building2 className="h-4 w-4" />} />
        <StatCard label="Постачальників" value={data?.supplierCount ?? 0} icon={<Users className="h-4 w-4" />} />
      </div>

      <SectionCard title="Швидкі дії">
        <div className="grid grid-cols-2 gap-3">
          <Link to="/suppliers" className="rounded-xl bg-secondary p-3 text-sm font-medium">
            Постачальники
          </Link>
          <Link to="/analytics" className="rounded-xl bg-secondary p-3 text-sm font-medium">
            <BarChart3 className="mb-1 h-4 w-4" /> Аналітика
          </Link>
        </div>
      </SectionCard>

      <SectionCard title="Користувачі">
        {!data?.profiles.length ? (
          <EmptyState title="Користувачів немає" />
        ) : (
          <ul className="divide-y divide-border">
            {data.profiles.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                <span>{p.full_name ?? "—"}</span>
                <span className="text-xs text-muted-foreground">
                  {p.branch_id ? "Філія" : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

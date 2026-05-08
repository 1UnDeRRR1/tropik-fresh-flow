import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Shield, ScrollText, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, StatCard, EmptyState } from "@/components/cards";

export const Route = createFileRoute("/_authenticated/dashboard/super-admin")({
  component: SuperAdminDashboard,
});

function SuperAdminDashboard() {
  const { data } = useQuery({
    queryKey: ["super-overview"],
    queryFn: async () => {
      const [users, logs, roles] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase
          .from("audit_logs")
          .select("id,action,entity,created_at,actor_id")
          .order("created_at", { ascending: false })
          .limit(10),
        supabase.from("user_roles").select("user_id,role"),
      ]);
      return {
        userCount: users.count ?? 0,
        roleCount: roles.data?.length ?? 0,
        logs: logs.data ?? [],
      };
    },
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Супер-адмін" subtitle="Повний контроль системи" />

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Користувачів" value={data?.userCount ?? 0} icon={<Users className="h-4 w-4" />} tone="primary" />
        <StatCard label="Ролей призначено" value={data?.roleCount ?? 0} icon={<Shield className="h-4 w-4" />} tone="brand" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link to="/suppliers" className="rounded-2xl border border-border bg-card p-4 shadow-card">
          <div className="text-sm font-semibold">Постачальники</div>
          <div className="text-xs text-muted-foreground">Управління</div>
        </Link>
        <Link to="/settings" className="rounded-2xl border border-border bg-card p-4 shadow-card">
          <div className="text-sm font-semibold">Налаштування</div>
          <div className="text-xs text-muted-foreground">Профіль і ролі</div>
        </Link>
      </div>

      <SectionCard title="Журнал дій" action={<ScrollText className="h-4 w-4 text-muted-foreground" />}>
        {!data?.logs.length ? (
          <EmptyState title="Запитів ще немає" hint="Дії користувачів зʼявляться тут" />
        ) : (
          <ul className="divide-y divide-border">
            {data.logs.map((l) => (
              <li key={l.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div className="font-medium">{l.action}</div>
                  <div className="text-xs text-muted-foreground">{l.entity}</div>
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(l.created_at).toLocaleString("uk-UA")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

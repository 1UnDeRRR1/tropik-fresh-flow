import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Inbox, ArrowLeftRight, Package } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { StatCard, SectionCard, EmptyState } from "@/components/cards";
import { StatusChip } from "@/components/StatusChip";

export const Route = createFileRoute("/_authenticated/dashboard/branch")({
  component: BranchDashboard,
});

function BranchDashboard() {
  const { profile } = useAuth();
  const branchId = profile?.branch_id;

  const { data: dists } = useQuery({
    queryKey: ["branch-dists", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributions")
        .select("id,status,dispatched_at,received_at, shipments(code, suppliers(name))")
        .eq("branch_id", branchId!)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  const incoming = dists?.filter((d) => ["planned", "dispatched"].includes(d.status)).length ?? 0;
  const received = dists?.filter((d) => d.status === "received").length ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader title="Філія" subtitle="Ваші вхідні поставки і трансфери" />

      {!branchId && (
        <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm">
          Вам ще не призначено філію. Зверніться до адміністратора.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Очікують прийому" value={incoming} icon={<Inbox className="h-4 w-4" />} tone="brand" />
        <StatCard label="Отримано" value={received} icon={<Package className="h-4 w-4" />} />
      </div>

      <SectionCard
        title="Вхідні поставки"
        action={
          <Link to="/shipments" className="text-xs font-medium text-brand">
            Усі
          </Link>
        }
      >
        {!dists?.length ? (
          <EmptyState title="Поки немає вхідних поставок" />
        ) : (
          <ul className="divide-y divide-border">
            {dists.map((d) => (
              <li key={d.id} className="flex items-center justify-between py-3">
                <div>
                  <div className="text-sm font-semibold">{d.shipments?.code ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">
                    {d.shipments?.suppliers?.name ?? "—"}
                  </div>
                </div>
                <StatusChip status={d.status} kind="distribution" />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <Link
        to="/transfers"
        className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 shadow-card active:scale-[0.98]"
      >
        <div>
          <div className="text-sm font-semibold">Трансфери між філіями</div>
          <div className="text-xs text-muted-foreground">Запит або підтвердження</div>
        </div>
        <ArrowLeftRight className="h-5 w-5 text-brand" />
      </Link>
    </div>
  );
}

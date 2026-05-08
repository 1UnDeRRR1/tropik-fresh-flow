import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { StatusChip } from "@/components/StatusChip";

export const Route = createFileRoute("/_authenticated/branch-requests")({
  component: BranchRequests,
});

function BranchRequests() {
  const { data } = useQuery({
    queryKey: ["branch-requests"],
    queryFn: async () => {
      const { data } = await supabase
        .from("branch_requests")
        .select("id,status,notes,created_at,branch:branches(name),shipment:shipments(code)")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Заявки філій" subtitle="Запити на товар із поставок" />
      <SectionCard title="Усі заявки">
        {!data?.length ? (
          <EmptyState title="Заявок ще немає" hint="Філії можуть створювати запити на товар" />
        ) : (
          <ul className="divide-y divide-border">
            {data.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-3 text-sm">
                <div>
                  <div className="font-medium">{r.branch?.name ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.shipment?.code ? `Поставка ${r.shipment.code}` : "Без прив'язки"} ·{" "}
                    {new Date(r.created_at).toLocaleDateString("uk-UA")}
                  </div>
                </div>
                <StatusChip status={r.status} kind="transfer" />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

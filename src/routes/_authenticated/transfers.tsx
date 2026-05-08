import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { StatusChip } from "@/components/StatusChip";

export const Route = createFileRoute("/_authenticated/transfers")({
  component: Transfers,
});

function Transfers() {
  const { data } = useQuery({
    queryKey: ["transfers"],
    queryFn: async () => {
      const { data } = await supabase
        .from("transfers")
        .select("id,status, fb:branches!transfers_from_branch_id_fkey(name), tb:branches!transfers_to_branch_id_fkey(name)")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });
  return (
    <div className="space-y-4">
      <PageHeader title="Трансфери" subtitle="Переміщення між філіями" />
      <SectionCard title="Усі трансфери">
        {!data?.length ? (
          <EmptyState title="Трансферів ще немає" />
        ) : (
          <ul className="divide-y divide-border">
            {data.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-3 text-sm">
                <div>
                  <div className="font-medium">
                    {t.fb?.name ?? "—"} → {t.tb?.name ?? "—"}
                  </div>
                </div>
                <StatusChip status={t.status} kind="transfer" />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { StatusChip } from "@/components/StatusChip";

export const Route = createFileRoute("/_authenticated/distribution")({
  component: Distribution,
});

function Distribution() {
  const { data } = useQuery({
    queryKey: ["distributions"],
    queryFn: async () => {
      const { data } = await supabase
        .from("distributions")
        .select("id,status,branch_id, branches(name), shipments(code)")
        .order("created_at", { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });
  return (
    <div className="space-y-4">
      <PageHeader title="Розподіл" subtitle="Розподіл поставок по філіях" />
      <SectionCard title="Останні розподіли">
        {!data?.length ? (
          <EmptyState title="Розподілів ще немає" hint="Створіть поставку та виконайте розподіл" />
        ) : (
          <ul className="divide-y divide-border">
            {data.map((d) => (
              <li key={d.id}>
                <Link to="/shipments" className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-sm font-semibold">{d.shipments?.code ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">→ {d.branches?.name ?? "—"}</div>
                  </div>
                  <StatusChip status={d.status} kind="distribution" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

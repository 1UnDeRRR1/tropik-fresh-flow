import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";

export const Route = createFileRoute("/_authenticated/notifications")({
  component: Notifications,
});

function Notifications() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["notifications", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });
  return (
    <div className="space-y-4">
      <PageHeader title="Сповіщення" />
      <SectionCard title="Стрічка">
        {!data?.length ? (
          <EmptyState title="Сповіщень ще немає" />
        ) : (
          <ul className="divide-y divide-border">
            {data.map((n) => (
              <li key={n.id} className="py-3">
                <div className="text-sm font-semibold">{n.title}</div>
                {n.body && <div className="text-xs text-muted-foreground">{n.body}</div>}
                <div className="mt-1 text-[10px] text-muted-foreground">
                  {new Date(n.created_at).toLocaleString("uk-UA")}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

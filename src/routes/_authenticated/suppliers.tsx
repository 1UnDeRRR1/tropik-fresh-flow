import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { toUaCountry } from "@/lib/countries";

export const Route = createFileRoute("/_authenticated/suppliers")({
  component: Suppliers,
});

function Suppliers() {
  const { data } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data } = await supabase.from("suppliers").select("*").order("name");
      return data ?? [];
    },
  });
  return (
    <div className="space-y-4">
      <PageHeader title="Постачальники" />
      <SectionCard title="База постачальників">
        {!data?.length ? (
          <EmptyState title="Постачальників ще немає" hint="Додайте перших постачальників" />
        ) : (
          <ul className="divide-y divide-border">
            {data.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-3">
                <div>
                  <div className="text-sm font-semibold">{s.name}</div>
                  <div className="text-xs text-muted-foreground">{toUaCountry(s.country) || "—"}</div>
                </div>
                <span className="text-xs text-muted-foreground">★ {s.rating ?? 0}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

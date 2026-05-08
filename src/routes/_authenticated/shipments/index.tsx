import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/shipments/")({
  component: ShipmentsList,
});

function ShipmentsList() {
  const { data } = useQuery({
    queryKey: ["shipments-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shipments")
        .select("id,code,status,eta,suppliers(name,country)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  return (
    <div className="space-y-4">
      <PageHeader
        title="Поставки"
        action={
          <Link to="/shipments/new">
            <Button size="sm" className="bg-brand text-brand-foreground hover:bg-brand/90">
              <Plus className="mr-1 h-4 w-4" /> Нова
            </Button>
          </Link>
        }
      />
      <SectionCard title="Усі поставки">
        {!data?.length ? (
          <EmptyState title="Поставок ще немає" hint="Створіть нову поставку" />
        ) : (
          <ul className="divide-y divide-border">
            {data.map((s) => (
              <li key={s.id}>
                <Link
                  to="/shipments/$id"
                  params={{ id: s.id }}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{s.code}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.suppliers?.name ?? "—"} · ETA {s.eta ?? "—"}
                    </div>
                  </div>
                  <StatusChip status={s.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

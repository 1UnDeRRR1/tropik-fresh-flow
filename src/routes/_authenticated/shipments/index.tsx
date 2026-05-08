import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { StatusChip, SHIPMENT_LABEL } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toUaCountry } from "@/lib/countries";

export const Route = createFileRoute("/_authenticated/shipments/")({
  component: ShipmentsList,
});

function ShipmentsList() {
  const [filter, setFilter] = useState<string>("all");
  const { data } = useQuery({
    queryKey: ["shipments-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shipments")
        .select(`
          id, code, status, eta, country, import_manager_id,
          suppliers(name, country),
          shipment_items(pallet_count),
          distributions(distribution_items(pallets))
        `)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const today = new Date().toISOString().slice(0, 10);
  const soonDate = new Date();
  soonDate.setDate(soonDate.getDate() + 3);
  const soon = soonDate.toISOString().slice(0, 10);

  const rows = useMemo(() => {
    return (data ?? []).map((s) => {
      const fact = (s.shipment_items ?? []).reduce((a: number, it: { pallet_count: number | null }) => a + Number(it.pallet_count ?? 0), 0);
      const dist = (s.distributions ?? []).reduce(
        (a: number, d: { distribution_items: { pallets: number | null }[] | null }) =>
          a + (d.distribution_items ?? []).reduce((aa, di) => aa + Number(di.pallets ?? 0), 0),
        0,
      );
      const isDelayed = s.status === "delayed" || (s.eta && s.eta < today && !["completed", "cancelled", "distributing"].includes(s.status));
      const isSoon = s.eta && s.eta >= today && s.eta <= soon && !["completed", "cancelled"].includes(s.status);
      const isCompleted = s.status === "completed";
      return { ...s, fact, dist, remaining: fact - dist, isDelayed, isSoon, isCompleted };
    });
  }, [data, today, soon]);

  const filtered = filter === "all" ? rows : rows.filter((r) => r.status === filter);

  const STATUSES = Object.keys(SHIPMENT_LABEL) as (keyof typeof SHIPMENT_LABEL)[];

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

      <div className="-mx-4 overflow-x-auto px-4">
        <div className="flex gap-2 pb-1">
          <FilterPill active={filter === "all"} onClick={() => setFilter("all")}>Усі</FilterPill>
          {STATUSES.map((s) => (
            <FilterPill key={s} active={filter === s} onClick={() => setFilter(s)}>
              {SHIPMENT_LABEL[s]}
            </FilterPill>
          ))}
        </div>
      </div>

      <SectionCard title={`Реєстр (${filtered.length})`}>
        {!filtered.length ? (
          <EmptyState title="Поставок немає" />
        ) : (
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="min-w-full border-separate border-spacing-0 text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="sticky left-0 z-10 bg-card py-2 pr-2 font-semibold">№</th>
                  <th className="px-2 py-2">Постачальник</th>
                  <th className="px-2 py-2">Країна</th>
                  <th className="px-2 py-2">ETA</th>
                  <th className="px-2 py-2">Статус</th>
                  <th className="px-2 py-2 text-right">FACT</th>
                  <th className="px-2 py-2 text-right">Розпод.</th>
                  <th className="px-2 py-2 text-right">Залиш.</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const tone = s.isDelayed
                    ? "bg-destructive/5"
                    : s.isCompleted
                      ? "bg-success/5"
                      : s.isSoon
                        ? "bg-warning/5"
                        : "";
                  return (
                    <tr key={s.id} className={cn("border-t border-border", tone)}>
                      <td className="sticky left-0 z-10 bg-card py-2 pr-2">
                        <Link to="/shipments/$id" params={{ id: s.id }} className="font-bold text-brand">
                          {s.code}
                        </Link>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">{s.suppliers?.name ?? "—"}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{toUaCountry(s.country ?? s.suppliers?.country ?? "") || "—"}</td>
                      <td className={cn("px-2 py-2 whitespace-nowrap", s.isDelayed && "font-bold text-destructive", s.isSoon && "font-bold text-warning")}>
                        {s.eta ?? "—"}
                      </td>
                      <td className="px-2 py-2"><StatusChip status={s.status} /></td>
                      <td className="px-2 py-2 text-right tabular-nums">{s.fact}</td>
                      <td className="px-2 py-2 text-right tabular-nums font-semibold text-brand">{s.dist}</td>
                      <td className={cn("px-2 py-2 text-right tabular-nums font-semibold", s.remaining < 0 ? "text-destructive" : s.remaining === 0 ? "text-success" : "")}>
                        {s.remaining}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <div className="text-[11px] text-muted-foreground">
        <span className="mr-3 inline-block h-2 w-2 rounded-full bg-destructive align-middle"></span>Затримка
        <span className="ml-4 mr-3 inline-block h-2 w-2 rounded-full bg-warning align-middle"></span>Скоро прибуде
        <span className="ml-4 mr-3 inline-block h-2 w-2 rounded-full bg-success align-middle"></span>Завершено
      </div>
    </div>
  );
}

function FilterPill({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition",
        active ? "border-brand bg-brand text-brand-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

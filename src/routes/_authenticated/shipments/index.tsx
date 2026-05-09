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
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/shipments/")({
  component: ShipmentsList,
});

function ShipmentsList() {
  const [filter, setFilter] = useState<string>("all");
  const { hasRole } = useAuth();
  const isStaff = hasRole(["super_admin", "admin", "import_manager"]);

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

      {isStaff && <OpenVehiclesBlock />}

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

type OpenVehicleRow = {
  id: string;
  code: string;
  country: string;
  loading_date: string | null;
  eta: string | null;
  total_pallets: number;
  total_weight_kg: number;
  shipments: { id: string; import_manager_id: string | null; suppliers: { name: string | null } | null }[] | null;
};

function OpenVehiclesBlock() {
  const { user } = useAuth();
  const { data, refetch } = useQuery({
    queryKey: ["open-vehicles-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles" as never)
        .select("id,code,country,loading_date,eta,total_pallets,total_weight_kg, shipments(id,import_manager_id,suppliers(name))")
        .eq("status", "open")
        .order("created_at", { ascending: false });
      if (error) return [] as OpenVehicleRow[];
      return (data ?? []) as unknown as OpenVehicleRow[];
    },
  });

  const closeVehicle = async (id: string) => {
    const { error } = await supabase
      .from("vehicles" as never)
      .update({ status: "closed", closed_at: new Date().toISOString() } as never)
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Авто закрите");
    refetch();
  };

  if (!data?.length) return null;

  return (
    <SectionCard title={`🚛 Відкриті авто (${data.length})`}>
      <div className="grid gap-2 sm:grid-cols-2">
        {data.map((v) => {
          const sups = (v.shipments ?? []).map((s) => s.suppliers?.name).filter(Boolean) as string[];
          const pallets = Number(v.total_pallets ?? 0);
          const weight = Number(v.total_weight_kg ?? 0);
          const palletsPct = Math.min(100, (pallets / 26) * 100);
          const weightPct = Math.min(100, (weight / 21500) * 100);
          // If current user owns one of the shipments in this vehicle → go straight to that shipment's products
          const ownShipment = (v.shipments ?? []).find((s) => s.import_manager_id === user?.id);
          const cardLink = ownShipment
            ? { to: "/shipments/$id/products" as const, params: { id: ownShipment.id }, search: undefined }
            : { to: "/shipments/new" as const, params: undefined, search: { vehicleId: v.id } };
          return (
            <Link
              key={v.id}
              to={cardLink.to}
              params={cardLink.params}
              search={cardLink.search}
              className="block rounded-xl border border-border bg-card p-3 transition active:scale-[0.99] hover:border-brand/40"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-brand">{v.code}</div>
                  <div className="truncate text-xs text-muted-foreground">{toUaCountry(v.country)} · ETA {v.eta ?? "—"}</div>
                </div>
                <div className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
                  <Link to="/shipments/new" search={{ vehicleId: v.id }}>
                    <Button size="sm" variant="secondary">+ Постач.</Button>
                  </Link>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      closeVehicle(v.id);
                    }}
                  >
                    Закрити
                  </Button>
                </div>
              </div>
              {sups.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {sups.map((s, i) => (
                    <span key={i} className="rounded-full bg-secondary px-2 py-0.5 text-[10px]">{s}</span>
                  ))}
                </div>
              )}
              <div className="mt-2 space-y-1.5 text-[11px]">
                <div className="flex items-center justify-between">
                  <span>Палети {pallets}/26</span>
                  <span className="text-muted-foreground">залиш. {Math.max(0, 26 - pallets)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full bg-brand" style={{ width: `${palletsPct}%` }} />
                </div>
                <div className="flex items-center justify-between">
                  <span>Вага {Math.round(weight)}/21500 кг</span>
                  <span className="text-muted-foreground">залиш. {Math.max(0, 21500 - Math.round(weight))} кг</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full bg-brand" style={{ width: `${weightPct}%` }} />
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </SectionCard>
  );
}


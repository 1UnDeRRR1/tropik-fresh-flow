import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState, useEffect } from "react";
import { Plus, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { StatusChip, SHIPMENT_LABEL } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toUaCountry } from "@/lib/countries";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

import { StaffOnly } from "@/components/StaffOnly";

export const Route = createFileRoute("/_authenticated/shipments/")({
  component: () => <StaffOnly><ShipmentsList /></StaffOnly>,
});

function ShipmentsList() {
  const [filter, setFilter] = useState<string>("all");
  const { hasRole, user } = useAuth();
  const isStaff = hasRole(["super_admin", "admin", "import_manager"]);
  const qc = useQueryClient();

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

  const filtered = rows
    .filter((r) => r.fact > 0)
    .filter((r) => {
      if (filter === "all") return true;
      if (filter === "done") return r.fact > 0 && r.remaining === 0;
      if (filter === "none") return r.fact > 0 && r.dist === 0;
      if (filter === "partial") return r.dist > 0 && r.remaining > 0;
      return true;
    })
    .sort((a, b) => {
      if (!a.eta && !b.eta) return 0;
      if (!a.eta) return 1;
      if (!b.eta) return -1;
      return a.eta.localeCompare(b.eta);
    });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Поставки"
        action={
          <Link to="/shipments/new">
            <Button size="sm" className="bg-brand text-brand-foreground hover:bg-brand/90">
              <Plus className="mr-1 h-4 w-4" /> Нова поставка
            </Button>
          </Link>
        }
      />

      {isStaff && <OpenVehiclesBlock />}

      <div className="-mx-4 overflow-x-auto px-4">
        <div className="flex gap-2 pb-1">
          <StatusFilterPill active={filter === "done"} onClick={() => setFilter(filter === "done" ? "all" : "done")} tone="success">Виконано</StatusFilterPill>
          <StatusFilterPill active={filter === "none"} onClick={() => setFilter(filter === "none" ? "all" : "none")} tone="destructive">Не розпод.</StatusFilterPill>
          <StatusFilterPill active={filter === "partial"} onClick={() => setFilter(filter === "partial" ? "all" : "partial")} tone="warning">Дорозподіл</StatusFilterPill>
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
                  <th className="px-2 py-2 text-right text-foreground">Факт</th>
                  <th className="px-2 py-2 text-right text-foreground">Розпод.</th>
                  <th className="px-2 py-2 text-right text-foreground">Залиш.</th>
                  <th className="px-2 py-2"></th>
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
                  const isOwner = !!user && s.import_manager_id === user.id;
                  return (
                    <tr key={s.id} className={cn("border-t border-border", tone)}>
                      <td className="sticky left-0 z-10 bg-card py-2 pr-2 whitespace-nowrap">
                        <Link to="/shipments/$id" params={{ id: s.id }} className="font-bold text-brand whitespace-nowrap">
                          {s.code}
                        </Link>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">{s.suppliers?.name ?? "—"}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{toUaCountry(s.country ?? s.suppliers?.country ?? "") || "—"}</td>
                      <td className={cn("px-2 py-2 whitespace-nowrap", s.isDelayed && "font-bold text-destructive", s.isSoon && "font-bold text-warning")}>
                        {s.eta ?? "—"}
                      </td>
                      <td className="px-2 py-2">
                        {s.fact > 0 && s.remaining === 0 ? (
                          <span className="inline-flex items-center rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">Виконано</span>
                        ) : s.fact > 0 && s.dist === 0 ? (
                          <span className="inline-flex items-center rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold text-destructive whitespace-nowrap">Не розпод.</span>
                        ) : s.dist > 0 && s.remaining > 0 ? (
                          <span className="inline-flex items-center rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning">Дорозподіл</span>
                        ) : (
                          <StatusChip status={s.status} />
                        )}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-foreground">{s.fact}</td>
                      <td className={cn("px-2 py-2 text-right tabular-nums font-semibold", s.dist === s.fact ? "text-success" : s.dist > 0 && s.remaining > 0 ? "text-warning" : "text-destructive")}>{s.dist}</td>
                      <td className={cn("px-2 py-2 text-right tabular-nums font-semibold", s.remaining === 0 ? "text-success" : s.dist > 0 && s.remaining > 0 ? "text-warning" : "text-destructive")}>
                        {s.remaining}
                      </td>
                      <td className="px-1 py-2">
                        {isOwner && (
                          <RowActions
                            shipmentId={s.id}
                            code={s.code}
                            onChanged={() => qc.invalidateQueries({ queryKey: ["shipments-list"] })}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

    </div>
  );
}

function StatusFilterPill({
  active,
  children,
  onClick,
  tone,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
  tone: "success" | "destructive" | "warning";
}) {
  const toneClasses = {
    success: {
      active: "border-success bg-success text-success-foreground",
      inactive: "border-success/40 bg-success/10 text-success hover:bg-success/20",
    },
    destructive: {
      active: "border-destructive bg-destructive text-destructive-foreground",
      inactive: "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20",
    },
    warning: {
      active: "border-warning bg-warning text-warning-foreground",
      inactive: "border-warning/40 bg-warning/10 text-warning hover:bg-warning/20",
    },
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition whitespace-nowrap",
        active ? toneClasses.active : toneClasses.inactive,
      )}
    >
      {children}
    </button>
  );
}

function RowActions({ shipmentId, code, onChanged }: { shipmentId: string; code: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const onDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
    if (!confirm(`Видалити поставку ${code}? Цю дію неможливо скасувати.`)) return;
    const { error } = await supabase.from("shipments").delete().eq("id", shipmentId);
    if (error) return toast.error(error.message);
    toast.success("Поставку видалено");
    onChanged();
  };

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label="Дії"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-36 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              navigate({ to: "/shipments/$id", params: { id: shipmentId } });
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
          >
            <Pencil className="h-3.5 w-3.5" /> Редагувати
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5" /> Видалити
          </button>
        </div>
      )}
    </div>
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
  const { user, hasRole } = useAuth();
  const isAdmin = hasRole(["super_admin", "admin"]);
  const navigate = useNavigate();
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
          const handleCardClick = () => {
            if (ownShipment) {
              navigate({ to: "/shipments/$id/products", params: { id: ownShipment.id } });
            } else {
              navigate({ to: "/shipments/new", search: { vehicleId: v.id } });
            }
          };
          return (
            <div
              key={v.id}
              role="button"
              tabIndex={0}
              onClick={handleCardClick}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleCardClick();
                }
              }}
              className="cursor-pointer rounded-xl border border-border bg-card p-3 transition active:scale-[0.99] hover:border-brand/40"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-brand">{v.code}</div>
                  <div className="truncate text-xs text-muted-foreground">{toUaCountry(v.country)} · ETA {v.eta ?? "—"}</div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate({ to: "/shipments/new", search: { vehicleId: v.id } });
                    }}
                  >
                    + Постач.
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!isAdmin && !ownShipment}
                    title={!isAdmin && !ownShipment ? "Закрити може лише адмін або менеджер, що додав свій товар" : undefined}
                    onClick={(e) => {
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
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}


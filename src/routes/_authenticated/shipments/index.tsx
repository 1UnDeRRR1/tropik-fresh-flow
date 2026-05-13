import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState, useEffect } from "react";
import { Plus, MoreVertical, Pencil, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { StatusChip, SHIPMENT_LABEL } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { toUaCountry } from "@/lib/countries";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { useFocusHighlight } from "@/lib/use-focus-highlight";
import { useStableQueryData } from "@/lib/query-stability";

import { StaffOnly } from "@/components/StaffOnly";
import { CostPair } from "@/components/CostPair";

export const Route = createFileRoute("/_authenticated/shipments/")({
  component: () => <StaffOnly><ShipmentsList /></StaffOnly>,
});

function isOwnedShipment(
  shipment: { import_manager_id: string | null; created_by?: string | null },
  userId?: string,
  currentManagerId?: string | null,
) {
  if (!userId) return false;
  return (
    shipment.created_by === userId
    || (!!currentManagerId && shipment.import_manager_id === currentManagerId)
    || shipment.import_manager_id === userId
  );
}

function ShipmentsList() {
  const [filter, setFilter] = useState<string>("all");
  const { hasRole, user } = useAuth();
  const isStaff = hasRole(["super_admin", "admin", "import_manager"]);
  const qc = useQueryClient();
  const { data: currentManagerId } = useQuery({
    queryKey: ["current-import-manager-id", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("current_import_manager_id");
      if (error) throw error;
      return data ?? null;
    },
  });

  const shipmentsQuery = useQuery({
    queryKey: ["shipments-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shipments")
        .select(`
          id, code, status, eta, country, import_manager_id, created_by,
          suppliers(name, country),
          shipment_items(pallet_count,pallet_weight,final_cost_indicative,final_cost_invoice),
          distributions(distribution_items(pallets))
        `)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data } = useStableQueryData({
    data: shipmentsQuery.data,
    isSuccess: shipmentsQuery.isSuccess,
    isFetching: shipmentsQuery.isFetching,
    isError: shipmentsQuery.isError,
    module: "shipments-list",
    countRows: (rows) => rows.length,
  });

  const today = new Date().toISOString().slice(0, 10);
  const soonDate = new Date();
  soonDate.setDate(soonDate.getDate() + 3);
  const soon = soonDate.toISOString().slice(0, 10);

  const rows = useMemo(() => {
    return (data ?? []).map((s) => {
      const items = (s.shipment_items ?? []) as Array<{ pallet_count: number | null; pallet_weight: number | null; final_cost_indicative: number | null; final_cost_invoice: number | null }>;
      const fact = items.reduce((a, it) => a + Number(it.pallet_count ?? 0), 0);
      const dist = (s.distributions ?? []).reduce(
        (a: number, d: { distribution_items: { pallets: number | null }[] | null }) =>
          a + (d.distribution_items ?? []).reduce((aa, di) => aa + Number(di.pallets ?? 0), 0),
        0,
      );
      // Weighted average cost by pallet weight (fallback to simple average).
      let wSum = 0, indSum = 0, invSum = 0, simpleN = 0, simpleInd = 0, simpleInv = 0;
      for (const it of items) {
        const w = Number(it.pallet_weight ?? 0) * Number(it.pallet_count ?? 0);
        const ind = Number(it.final_cost_indicative ?? 0);
        const inv = Number(it.final_cost_invoice ?? 0);
        if (ind || inv) {
          simpleN++; simpleInd += ind; simpleInv += inv;
          if (w > 0) { wSum += w; indSum += ind * w; invSum += inv * w; }
        }
      }
      const avgInd = wSum > 0 ? indSum / wSum : (simpleN > 0 ? simpleInd / simpleN : 0);
      const avgInv = wSum > 0 ? invSum / wSum : (simpleN > 0 ? simpleInv / simpleN : 0);
      const isDelayed = s.status === "delayed" || (s.eta && s.eta < today && !["completed", "cancelled", "distributing"].includes(s.status));
      const isSoon = s.eta && s.eta >= today && s.eta <= soon && !["completed", "cancelled"].includes(s.status);
      const isCompleted = s.status === "completed";
      return { ...s, fact, dist, remaining: fact - dist, isDelayed, isSoon, isCompleted, avgInd, avgInv };
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

  useFocusHighlight([filtered]);

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

      {isStaff && <OpenVehiclesBlock currentManagerId={currentManagerId} />}

      <div className="-mx-4 overflow-x-auto px-4">
        <div className="flex gap-2 pb-1">
          <StatusFilterPill active={filter === "done"} onClick={() => setFilter(filter === "done" ? "all" : "done")} tone="success">Виконано</StatusFilterPill>
          <StatusFilterPill active={filter === "none"} onClick={() => setFilter(filter === "none" ? "all" : "none")} tone="destructive">Не розпод.</StatusFilterPill>
          <StatusFilterPill active={filter === "partial"} onClick={() => setFilter(filter === "partial" ? "all" : "partial")} tone="warning">Дорозподіл</StatusFilterPill>
        </div>
      </div>


      <SectionCard title={`Реєстр (${filtered.length})`}>
        {!filtered.length ? (
          shipmentsQuery.isFetching || !shipmentsQuery.isSuccess ? (
            <p className="text-sm text-muted-foreground">Оновлення даних…</p>
          ) : (
          <EmptyState title="Поставок немає" />
          )
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
                  <th className="px-2 py-2 text-right text-foreground">Собів. $/кг</th>
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
                  const isOwner = isOwnedShipment(s, user?.id, currentManagerId);
                  return (
                    <tr key={s.id} data-focus-id={`ship:${s.id} mgr:${s.import_manager_id ?? ""}`} className={cn("border-t border-border", tone)}>
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
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        {(s.avgInd || s.avgInv) ? (
                          <CostPair indicative={s.avgInd} invoice={s.avgInv} suffix=" кг" size="xs" />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
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
  created_by: string | null;
  shipments: { id: string; import_manager_id: string | null; created_by?: string | null; suppliers: { name: string | null } | null }[] | null;
};

function OpenVehiclesBlock({ currentManagerId }: { currentManagerId?: string | null }) {
  const { user, hasRole } = useAuth();
  const isAdmin = hasRole(["super_admin", "admin"]);
  const navigate = useNavigate();
  const { data, refetch } = useQuery({
    queryKey: ["open-vehicles-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles" as never)
        .select("id,code,country,loading_date,eta,total_pallets,total_weight_kg,created_by, shipments(id,import_manager_id,created_by,suppliers(name))")
        .eq("status", "open")
        .order("created_at", { ascending: false });
      if (error) return [] as OpenVehicleRow[];
      return (data ?? []) as unknown as OpenVehicleRow[];
    },
  });

  const closeVehicle = async (id: string) => {
    // Validate all shipment items in this vehicle have required fields
    const { data: ships } = await supabase
      .from("shipments" as never)
      .select("id")
      .eq("vehicle_id", id);
    const shipIds = ((ships ?? []) as { id: string }[]).map((s) => s.id);
    if (shipIds.length > 0) {
      const { data: items } = await supabase
        .from("shipment_items" as never)
        .select("product_name,origin_country,pallet_count,pallet_weight,unit_price")
        .in("shipment_id", shipIds);
      const rows = (items ?? []) as Array<{ product_name: string | null; origin_country: string | null; pallet_count: number | null; pallet_weight: number | null; unit_price: number | null }>;
      const bad = rows.filter((r) => {
        const pc = Number(r.pallet_count ?? 0);
        const pw = Number(r.pallet_weight ?? 0);
        return pc > 0 && (
          !(r.product_name ?? "").trim() ||
          (r.product_name ?? "") === "Новий товар" ||
          !(r.origin_country ?? "").trim() ||
          pc * pw <= 0 ||
          !r.unit_price || Number(r.unit_price) <= 0
        );
      }).length;
      if (bad > 0) {
        toast.error(`Не можна закрити: ${bad} поз. з незаповн. полями (товар / країна / палети / вага / ціна)`);
        return;
      }
    }
    const { error } = await supabase
      .from("vehicles" as never)
      .update({ status: "closed", closed_at: new Date().toISOString() } as never)
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Авто закрите");
    refetch();
  };

  useFocusHighlight([data]);

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
          const ownShipment = (v.shipments ?? []).find((s) => isOwnedShipment(s, user?.id, currentManagerId));
          const handleCardClick = () => {
            if (ownShipment) {
              navigate({ to: "/shipments/$id/products", params: { id: ownShipment.id } });
            } else {
              navigate({ to: "/shipments/new", search: { vehicleId: v.id } });
            }
          };
          return (
            <VehicleCard
              key={v.id}
              v={v}
              sups={sups}
              pallets={pallets}
              weight={weight}
              palletsPct={palletsPct}
              weightPct={weightPct}
              ownShipment={ownShipment}
              isAdmin={isAdmin}
              onCardClick={handleCardClick}
              onAddSupplier={() => navigate({ to: "/shipments/new", search: { vehicleId: v.id } })}
              onClose={() => closeVehicle(v.id)}
              onDeleted={() => refetch()}
            />
          );
        })}
      </div>
    </SectionCard>
  );
}

function VehicleCard({
  v, sups, pallets, weight, palletsPct, weightPct, ownShipment, isAdmin,
  onCardClick, onAddSupplier, onClose, onDeleted,
}: {
  v: OpenVehicleRow;
  sups: string[];
  pallets: number;
  weight: number;
  palletsPct: number;
  weightPct: number;
  ownShipment: { id: string; import_manager_id: string | null } | undefined;
  isAdmin: boolean;
  onCardClick: () => void;
  onAddSupplier: () => void;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const DELETE_REVEAL = 144;
  const SWIPE_ACTIVATION = 6;
  const SWIPE_OPEN_THRESHOLD = 36;
  const SWIPE_CLOSE_THRESHOLD = 18;
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const swipeOffsetRef = useRef(0);
  const gesture = useRef<{
    pointerId: number | null;
    startX: number;
    startY: number;
    startOffset: number;
    dragging: boolean;
  }>({
    pointerId: null,
    startX: 0,
    startY: 0,
    startOffset: 0,
    dragging: false,
  });
  const suppressClick = useRef(false);

  const setSwipePosition = (nextOffset: number) => {
    swipeOffsetRef.current = nextOffset;
    setSwipeOffset(nextOffset);
  };

  const closeDelete = () => {
    setDeleteOpen(false);
    setSwipePosition(0);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!ownShipment) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select")) return;
    gesture.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startOffset: deleteOpen ? -DELETE_REVEAL : 0,
      dragging: false,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const resetGesture = () => {
    gesture.current = {
      pointerId: null,
      startX: 0,
      startY: 0,
      startOffset: 0,
      dragging: false,
    };
    setDragging(false);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!ownShipment) return;
    if (gesture.current.pointerId !== e.pointerId) return;

    const dx = e.clientX - gesture.current.startX;
    const dy = e.clientY - gesture.current.startY;

    if (!gesture.current.dragging) {
      if (Math.abs(dx) < SWIPE_ACTIVATION && Math.abs(dy) < SWIPE_ACTIVATION) return;
      if (Math.abs(dy) > Math.abs(dx) * 1.15) {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        resetGesture();
        return;
      }
      gesture.current.dragging = true;
      setDragging(true);
      suppressClick.current = true;
    }

    e.preventDefault();
    const nextOffset = Math.max(-DELETE_REVEAL, Math.min(0, gesture.current.startOffset + dx));
    setSwipePosition(nextOffset);
  };

  const handlePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (gesture.current.pointerId !== e.pointerId) return;

    e.currentTarget.releasePointerCapture?.(e.pointerId);

    if (gesture.current.dragging) {
      const finalOffset = swipeOffsetRef.current;
      const shouldOpen = deleteOpen
        ? finalOffset <= -SWIPE_CLOSE_THRESHOLD
        : finalOffset <= -SWIPE_OPEN_THRESHOLD;
      setDeleteOpen(shouldOpen);
      setSwipePosition(shouldOpen ? -DELETE_REVEAL : 0);
      suppressClick.current = true;
    }

    resetGesture();
  };

  const handleCardClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (deleteOpen) {
      closeDelete();
      return;
    }
    onCardClick();
  };

  const doDelete = async () => {
    if (!ownShipment) return;
    setConfirmOpen(false);
    closeDelete();
    const { error } = await supabase.from("shipments").delete().eq("id", ownShipment.id);
    if (error) return toast.error(error.message);
    toast.success("Поставку видалено");
    onDeleted();
  };

  return (
    <>
      <div
        data-focus-id={`v:${v.id} ${(v.shipments ?? []).map((s) => `mgr:${s.import_manager_id ?? ""}`).join(" ")}`}
        className="relative overflow-hidden rounded-xl border border-border bg-card hover:border-brand/40"
      >
        {ownShipment && (
          <div className="absolute inset-y-0 right-0 z-0 flex w-36 items-stretch justify-end">
            <div className="flex w-36 items-stretch">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  closeDelete();
                }}
                className="flex w-11 items-center justify-center bg-secondary text-secondary-foreground transition-opacity hover:bg-secondary/80"
                aria-label="Скасувати свайп"
              >
                <X className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmOpen(true);
                }}
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-1 bg-destructive text-destructive-foreground transition-opacity",
                  deleteOpen ? "opacity-100" : "opacity-80",
                )}
                aria-label="Видалити поставку"
              >
                <Trash2 className="h-5 w-5" />
                <span className="text-[11px] font-semibold">Видалити</span>
              </button>
            </div>
          </div>
        )}

        <div
          role="button"
          tabIndex={0}
          onClick={handleCardClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (deleteOpen) {
                closeDelete();
                return;
              }
              onCardClick();
            }
            if (e.key === "Escape" && deleteOpen) {
              e.preventDefault();
              closeDelete();
            }
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          style={{ transform: `translateX(${swipeOffset}px)`, touchAction: ownShipment ? "pan-y" : "auto" }}
          className={cn(
            "relative z-10 cursor-pointer select-none rounded-xl bg-card p-3 active:scale-[0.99]",
            dragging ? "transition-none" : "transition-transform duration-260 ease-out",
          )}
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
                onClick={(e) => { e.stopPropagation(); onAddSupplier(); }}
              >
                + Постач.
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!isAdmin && !ownShipment}
                title={!isAdmin && !ownShipment ? "Закрити може лише адмін або менеджер, що додав свій товар" : undefined}
                onClick={(e) => { e.stopPropagation(); onClose(); }}
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
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Видалити поставку?</AlertDialogTitle>
            <AlertDialogDescription>
              Поставка з авто {v.code} буде видалена без можливості відновлення.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Ні</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void doDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Так, видалити
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}


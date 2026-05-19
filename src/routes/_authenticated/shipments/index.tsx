import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState, useEffect } from "react";
import { Plus, MoreVertical, Pencil, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { StatusChip, SHIPMENT_LABEL, shipmentCodeTextTone } from "@/components/StatusChip";
import { PipelineStatusBadge } from "@/components/PipelineStatusBadge";
import type { PipelineStatus } from "@/lib/pipeline-status";
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
import { TableScroller } from "@/components/TableScroller";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check } from "lucide-react";
import { MainBoardToggle, type BoardView } from "@/components/MainBoardToggle";
import { ShipmentQuickView } from "@/components/ShipmentQuickView";

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
  const [tab, setTab] = useState<"shipments" | "vehicles">("shipments");
  const [board, setBoard] = useState<BoardView>("active");
  const [managerFilter, setManagerFilter] = useState<string>("all");
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const { hasRole, user } = useAuth();
  const isStaff = hasRole(["super_admin", "admin", "import_manager"]);
  const isAdmin = hasRole(["super_admin", "admin"]);
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
          id, code, status, pipeline_status, eta, country, import_manager_id, created_by, unloaded_at, archived_at, cancelled_at,
          loading_address, loading_reference, tractor_plate, vehicle_plate, driver_name, temperature_mode,
          suppliers(name, country),
          import_managers(full_name),
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

  const managerOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      const id = (r as { import_manager_id?: string | null }).import_manager_id;
      const name = (r as { import_managers?: { full_name?: string | null } | null }).import_managers?.full_name;
      if (id && name) map.set(id, name);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);
  const supplierOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const name = (r as { suppliers?: { name?: string | null } | null }).suppliers?.name;
      if (name) set.add(name);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filtered = rows
    .filter((r) => {
      const u = (r as { unloaded_at?: string | null; archived_at?: string | null }).unloaded_at;
      const arch = (r as { archived_at?: string | null }).archived_at;
      if (arch) return false;
      if (board === "unloaded") return !!u;
      return !u;
    })
    .filter((r) => r.fact > 0)
    .filter((r) => {
      if (filter === "all") return true;
      if (filter === "done") return r.fact > 0 && r.remaining === 0;
      if (filter === "none") return r.fact > 0 && r.dist === 0;
      if (filter === "partial") return r.dist > 0 && r.remaining > 0;
      return true;
    })
    .filter((r) => {
      if (!isAdmin || managerFilter === "all") return true;
      return (r as { import_manager_id?: string | null }).import_manager_id === managerFilter;
    })
    .filter((r) => {
      if (!isAdmin || supplierFilter === "all") return true;
      return (r as { suppliers?: { name?: string | null } | null }).suppliers?.name === supplierFilter;
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

      <MainBoardToggle value={board} onChange={setBoard} />

      {isStaff && (
        <div className="inline-flex rounded-full border border-border bg-card p-1 text-xs">
          <button
            type="button"
            onClick={() => setTab("shipments")}
            className={cn(
              "rounded-full px-3 py-1.5 font-semibold transition",
              tab === "shipments" ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            Поставки
          </button>
          <button
            type="button"
            onClick={() => setTab("vehicles")}
            className={cn(
              "rounded-full px-3 py-1.5 font-semibold transition",
              tab === "vehicles" ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            Відкриті авто
          </button>
        </div>
      )}

      {tab === "vehicles" && isStaff ? (
        <OpenVehiclesBlock currentManagerId={currentManagerId} />
      ) : (
        <>
          <div className="-mx-4 overflow-x-auto px-4">
            <div className="flex flex-wrap items-center gap-2 pb-1">
              <StatusFilterPill active={filter === "done"} onClick={() => setFilter(filter === "done" ? "all" : "done")} tone="success">Виконано</StatusFilterPill>
              <StatusFilterPill active={filter === "none"} onClick={() => setFilter(filter === "none" ? "all" : "none")} tone="destructive">Не розпод.</StatusFilterPill>
              <StatusFilterPill active={filter === "partial"} onClick={() => setFilter(filter === "partial" ? "all" : "partial")} tone="warning">Дорозподіл</StatusFilterPill>
              {isAdmin && (
                <>
                  <select
                    value={managerFilter}
                    onChange={(e) => setManagerFilter(e.target.value)}
                    className="h-7 shrink-0 rounded-full border border-border bg-card px-2 text-[11px] font-semibold text-foreground"
                  >
                    <option value="all">Усі менеджери</option>
                    {managerOptions.map(([id, name]) => (
                      <option key={id} value={id}>{name}</option>
                    ))}
                  </select>
                  <select
                    value={supplierFilter}
                    onChange={(e) => setSupplierFilter(e.target.value)}
                    className="h-7 shrink-0 rounded-full border border-border bg-card px-2 text-[11px] font-semibold text-foreground"
                  >
                    <option value="all">Усі постачальники</option>
                    {supplierOptions.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                  {(managerFilter !== "all" || supplierFilter !== "all") && (
                    <button
                      type="button"
                      onClick={() => { setManagerFilter("all"); setSupplierFilter("all"); }}
                      className="shrink-0 rounded-full border border-border bg-card px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
                    >
                      Скинути
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {!filtered.length ? (
            shipmentsQuery.isFetching || !shipmentsQuery.isSuccess ? (
              <p className="text-sm text-muted-foreground">Оновлення даних…</p>
            ) : (
              <EmptyState title="Поставок немає" />
            )
          ) : (
            <TableScroller>
              <table className="min-w-[1100px] w-full border-separate border-spacing-0 text-xs">
                <thead className="[&_th]:bg-table-head [&_th]:backdrop-blur [&_th]:font-bold">
                  <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="sticky left-0 z-40 py-2 pr-2 w-[120px] min-w-[120px] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">№</th>
                    <th className="px-2 py-2 w-[110px] min-w-[110px]">Статус</th>
                    <th className="px-2 py-2">Постачальник</th>
                    <th className="px-2 py-2">Країна</th>
                    <th className="px-2 py-2">ETA</th>
                    <th className="px-2 py-2">Розподілено</th>
                    <th className="px-2 py-2 text-right text-foreground">Факт</th>
                    <th className="px-2 py-2 text-right text-foreground">Розпод.</th>
                    <th className="px-2 py-2 text-right text-foreground">Залиш.</th>
                    <th className="px-2 py-2 text-center text-foreground">Логістика</th>
                    {isAdmin && <th className="px-2 py-2 whitespace-nowrap">Відповідальний менеджер</th>}
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
                        <td className="sticky left-0 z-10 py-2 pr-2 whitespace-nowrap w-[120px] min-w-[120px] bg-card shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">
                          <ShipmentQuickView
                            shipmentId={s.id}
                            code={s.code}
                            className={cn("font-bold whitespace-nowrap text-left", shipmentCodeTextTone(s.status))}
                          />
                        </td>
                        <td className="px-2 py-2 w-[130px] min-w-[130px]">
                          {s.pipeline_status ? (
                            <PipelineStatusBadge status={s.pipeline_status as PipelineStatus} variant="animated" />
                          ) : (
                            <StatusChip status={s.status} />
                          )}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap">{s.suppliers?.name ?? "—"}</td>
                        <td className="px-2 py-2 whitespace-nowrap">{toUaCountry(s.country ?? s.suppliers?.country ?? "") || "—"}</td>
                        <td className={cn("px-2 py-2 whitespace-nowrap", s.isDelayed && "font-bold text-destructive", s.isSoon && "font-bold text-warning")}>
                          {s.eta ?? "—"}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          {s.fact > 0 && s.remaining === 0 ? (
                            <span className="inline-flex items-center rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">Виконано</span>
                          ) : s.fact > 0 && s.dist === 0 ? (
                            <span className="inline-flex items-center rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold text-destructive whitespace-nowrap">Не розпод.</span>
                          ) : s.dist > 0 && s.remaining > 0 ? (
                            <span className="inline-flex items-center rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning">Дорозподіл</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-foreground">{s.fact}</td>
                        <td className={cn("px-2 py-2 text-right tabular-nums font-semibold", s.dist === s.fact ? "text-success" : s.dist > 0 && s.remaining > 0 ? "text-warning" : "text-destructive")}>{s.dist}</td>
                        <td className={cn("px-2 py-2 text-right tabular-nums font-semibold", s.remaining === 0 ? "text-success" : s.dist > 0 && s.remaining > 0 ? "text-warning" : "text-destructive")}>
                          {s.remaining}
                        </td>
                        <td className="px-2 py-2 text-center">
                          <LogisticsIndicator
                            vehicle={s.tractor_plate ?? s.vehicle_plate ?? null}
                            driver={s.driver_name ?? null}
                            address={s.loading_address ?? null}
                            reference={s.loading_reference ?? null}
                            temperature={(s as { temperature_mode?: string | null }).temperature_mode ?? null}
                          />
                        </td>
                        {isAdmin && (
                          <td className="px-2 py-2 whitespace-nowrap text-foreground">
                            {(s as { import_managers?: { full_name?: string | null } | null }).import_managers?.full_name ?? "—"}
                          </td>
                        )}
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
            </TableScroller>
          )}
        </>
      )}

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

function LogisticsIndicator({
  vehicle,
  driver,
  address,
  reference,
  temperature,
}: {
  vehicle: string | null;
  driver: string | null;
  address: string | null;
  reference: string | null;
  temperature: string | null;
}) {
  const items = [
    { label: "Авто", value: vehicle },
    { label: "Водій", value: driver },
    { label: "Адреса завантаження", value: address },
    { label: "Номер завантаження", value: reference },
    { label: "Температура", value: temperature },
  ];
  const done = items.filter((i) => !!i.value && String(i.value).trim() !== "").length;
  const total = items.length;
  const missing = total - done;
  const tone =
    done === total
      ? "bg-success/15 text-success border-success/30"
      : done === 0
        ? "bg-destructive/15 text-destructive border-destructive/30"
        : done >= total - 1
          ? "bg-success/10 text-success border-success/30"
          : "bg-destructive/10 text-destructive border-destructive/30";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold tabular-nums",
            tone,
          )}
        >
          <span className="text-success">{done}</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-destructive">{missing}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-56 p-2">
        <ul className="space-y-1 text-xs">
          {items.map((i) => {
            const ok = !!i.value && String(i.value).trim() !== "";
            return (
              <li key={i.label} className="flex items-center gap-2">
                {ok ? (
                  <Check className="h-3.5 w-3.5 text-success" />
                ) : (
                  <X className="h-3.5 w-3.5 text-destructive" />
                )}
                <span className={cn(ok ? "text-foreground" : "text-muted-foreground")}>
                  {i.label}
                </span>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
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

  return (
    <SectionCard title={`🚛 Відкриті авто (${data?.length ?? 0})`}>
      {!data?.length ? (
        <EmptyState title="Відкритих авто немає" />
      ) : (
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
      )}
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
            "relative z-10 cursor-pointer select-none rounded-xl bg-card p-2 active:scale-[0.99]",
            dragging ? "transition-none" : "transition-transform duration-[260ms] ease-out",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-bold text-brand leading-tight">{v.code}</div>
              <div className="truncate text-[10px] text-muted-foreground leading-tight">{toUaCountry(v.country)} · ETA {v.eta ?? "—"}</div>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                size="sm"
                variant="secondary"
                className="h-7 px-2 text-[11px]"
                onClick={(e) => { e.stopPropagation(); onAddSupplier(); }}
              >
                + Постач.
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[11px]"
                disabled={!isAdmin && !ownShipment}
                title={!isAdmin && !ownShipment ? "Закрити може лише адмін або менеджер, що додав свій товар" : undefined}
                onClick={(e) => { e.stopPropagation(); onClose(); }}
              >
                Закрити
              </Button>
            </div>
          </div>
          {sups.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {sups.map((s, i) => (
                <span key={i} className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px]">{s}</span>
              ))}
            </div>
          )}
          <div className="mt-1.5 space-y-1 text-[10px]">
            <div className="flex items-center justify-between">
              <span>Палети {pallets}/26</span>
              <span className="text-muted-foreground">залиш. {Math.max(0, 26 - pallets)}</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-secondary">
              <div className="h-full bg-brand" style={{ width: `${palletsPct}%` }} />
            </div>
            <div className="flex items-center justify-between">
              <span>Вага {Math.round(weight)}/21500 кг</span>
              <span className="text-muted-foreground">залиш. {Math.max(0, 21500 - Math.round(weight))} кг</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-secondary">
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
              Так
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}


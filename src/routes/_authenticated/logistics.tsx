import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Truck, FileText, Save, AlertTriangle, User, MapPin, Hash, Thermometer, ArrowDownUp, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { EmptyState } from "@/components/cards";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  LOGISTICS_STATUS_LABEL,
  type LogisticsStatus,
} from "@/lib/logistics";

export const Route = createFileRoute("/_authenticated/logistics")({
  component: LogisticsGate,
});

// Short date formatter mirrored from accepted "Поставки" row.
const fmtShort = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  const mo = d.toLocaleDateString("uk-UA", { month: "short" }).replace(/\.$/, "");
  return `${day}\u202F${mo}.`;
};

type SortKey = "last_event" | "etd" | "eta" | "status";
const SORT_LABEL: Record<SortKey, string> = {
  last_event: "останньою подією",
  etd: "ETD",
  eta: "ETA",
  status: "статусом",
};

function SortMenu({ value, onChange }: { value: SortKey; onChange: (v: SortKey) => void }) {
  const [open, setOpen] = useState(false);
  const keys: SortKey[] = ["last_event", "etd", "eta", "status"];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 rounded-full px-3 text-[11px] font-semibold"
        >
          <ArrowDownUp className="h-3.5 w-3.5" />
          Сортувати за: <span className="font-bold">{SORT_LABEL[value]}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-1">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => { onChange(k); setOpen(false); }}
            className={cn(
              "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-accent",
              value === k && "font-semibold",
            )}
          >
            <span>{SORT_LABEL[k]}</span>
            {value === k && <Check className="h-4 w-4 text-primary" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function LogisticsGate() {
  const { loading, dataLoaded, hasRole } = useAuth();
  if (loading || !dataLoaded) return null;
  if (!hasRole(["super_admin", "admin", "import_manager", "logistics"])) {
    return <Navigate to="/" />;
  }
  return <LogisticsPage />;
}

type LogisticsRow = {
  id: string;
  code: string;
  status: string;
  logistics_status: LogisticsStatus;
  loading_date: string | null;
  eta: string | null;
  country: string | null;
  loading_address: string | null;
  loading_reference: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  vehicle_plate: string | null;
  tractor_plate: string | null;
  trailer_plate: string | null;
  notes: string | null;
  logistics_comment: string | null;
  loading_started_at: string | null;
  loading_ended_at: string | null;
  logistics_cost: number | null;
  logistics_cost_currency: string | null;
  final_freight_amount: number | null;
  final_freight_currency: string | null;
  final_freight_payment: string | null;
  final_freight_locked_at: string | null;
  temperature_mode: string | null;
  supplier: { name: string | null; import_manager_id: string | null } | null;
  import_manager_id: string | null;
  unloaded_at: string | null;
  archived_at: string | null;
  updated_at: string | null;
  items: Array<{
    product_name: string;
    pallet_count: number | null;
    pallet_weight: number | null;
    gross_weight_kg: number | null;
    origin_country: string | null;
  }>;
};

function resolveManagerName(
  row: Pick<LogisticsRow, "import_manager_id" | "supplier">,
  map: Record<string, string>,
): string | null {
  const id = row.import_manager_id ?? row.supplier?.import_manager_id ?? null;
  if (!id) return null;
  return map[id] ?? null;
}

function LogisticsPage() {
  const { user, hasRole } = useAuth();
  const [editing, setEditing] = useState<LogisticsRow | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("last_event");

  // Manager-only visibility scope: an import_manager (without admin/logistics)
  // must only see vehicles that belong to him.
  const isPrivileged = hasRole(["super_admin", "admin", "logistics"]);
  const isManagerOnly = !isPrivileged && hasRole("import_manager");

  const { data: myImId = null } = useQuery({
    queryKey: ["logistics-my-im-id", user?.id ?? null],
    enabled: !!user?.id && isManagerOnly,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("import_managers")
        .select("id")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data?.id ?? null;
    },
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["logistics-board"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("shipments")
        .select(
          `id, code, status, logistics_status, loading_date, eta, country,
           unloaded_at, archived_at, updated_at,
           loading_address, loading_reference, driver_name, driver_phone,
           vehicle_plate, tractor_plate, trailer_plate,
           notes, logistics_comment, loading_started_at, loading_ended_at,
           logistics_cost, logistics_cost_currency,
           final_freight_amount, final_freight_currency, final_freight_payment, final_freight_locked_at,
           temperature_mode,
           import_manager_id,
           supplier:suppliers(name, import_manager_id),
           items:shipment_items(product_name, pallet_count, pallet_weight, gross_weight_kg, origin_country)`,
        )
        .or("notes.is.null,notes.not.ilike.%[proposal-draft]%")
        .not("supplier_id", "is", null)
        .order("loading_date", { ascending: true, nullsFirst: false })
        .limit(500);
      if (error) throw error;
      return ((data ?? []) as unknown as LogisticsRow[]).filter((r) => r.items.length > 0);
    },
  });

  const { data: managerMap = {} } = useQuery({
    queryKey: ["logistics-managers"],
    queryFn: async () => {
      const { data } = await supabase.from("import_managers").select("id, full_name");
      const map: Record<string, string> = {};
      for (const m of data ?? []) map[m.id] = m.full_name ?? "";
      return map;
    },
    staleTime: 5 * 60_000,
  });

  // Manager-only ownership filter.
  const ownedRows = useMemo(() => {
    if (!isManagerOnly) return rows;
    if (!myImId) return [];
    return rows.filter(
      (r) => r.import_manager_id === myImId || r.supplier?.import_manager_id === myImId,
    );
  }, [rows, isManagerOnly, myImId]);

  // Active only: exclude unloaded / archived / cancelled.
  const activeRows = useMemo(
    () =>
      ownedRows.filter(
        (r) => !r.archived_at && !r.unloaded_at && r.status !== "cancelled",
      ),
    [ownedRows],
  );

  const sorted = useMemo(() => {
    const arr = [...activeRows];
    const cmpStr = (a: string | null | undefined, b: string | null | undefined) => {
      if (!a && !b) return 0;
      if (!a) return 1;
      if (!b) return -1;
      return a.localeCompare(b);
    };
    arr.sort((a, b) => {
      switch (sortBy) {
        case "etd":
          return cmpStr(a.loading_date, b.loading_date);
        case "eta":
          return cmpStr(a.eta, b.eta);
        case "status":
          return cmpStr(a.logistics_status, b.logistics_status);
        case "last_event":
        default:
          // Last real saved data change. With dirty-save guard, updated_at
          // only advances when a real field changed in the form.
          // Most recent first.
          return -cmpStr(a.updated_at, b.updated_at);
      }
    });
    return arr;
  }, [activeRows, sortBy]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <PageHeader title="Логістика" />
        <SortMenu value={sortBy} onChange={setSortBy} />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Завантаження…</p>
      ) : sorted.length === 0 ? (
        <EmptyState title="Порожньо" hint="Немає активних поставок." />
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-border bg-card divide-y divide-border shadow-sm">
          {sorted.map((r) => {
            const totalPallets = r.items.reduce((s, i) => s + (Number(i.pallet_count) || 0), 0);
            const vehicle = r.tractor_plate ?? r.vehicle_plate ?? null;
            const indicators = [
              { icon: Truck, label: "Авто", ok: !!vehicle },
              { icon: User, label: "Водій", ok: !!r.driver_name },
              { icon: MapPin, label: "Адреса завантаження", ok: !!r.loading_address },
              { icon: Hash, label: "Номер завантаження", ok: !!r.loading_reference },
              { icon: Thermometer, label: "Температура", ok: !!r.temperature_mode },
            ];
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setEditing(r)}
                  className="block w-full text-left p-3 transition-colors hover:bg-accent/30 active:bg-accent/40"
                >
                  {/* Shared grid so supplier (line 1) and country (line 2)
                      align exactly under each other, and the ETD/ETA block
                      occupies the same column as the shipment code. */}
                  <div className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-baseline gap-x-2">
                    {/* Line 1 */}
                    <span className="text-sm font-bold leading-snug text-foreground">
                      {r.code}
                    </span>
                    <span className="text-sm leading-snug text-muted-foreground">·</span>
                    <span className="truncate text-sm font-bold leading-snug text-foreground">
                      {r.supplier?.name ?? "—"}
                    </span>
                    <span className="pl-2 text-sm font-bold tabular-nums text-foreground">
                      {totalPallets || 0}п
                    </span>

                    {/* Line 2 */}
                    <span className="mt-1 text-xs tabular-nums leading-snug">
                      <span className="font-semibold text-sky-600 dark:text-sky-300">ETD</span>
                      <span className="text-foreground"> {fmtShort(r.loading_date)}</span>
                      <span className="text-foreground"> / </span>
                      <span className="font-semibold text-sky-600 dark:text-sky-300">ETA</span>
                      <span className="text-foreground"> {fmtShort(r.eta)}</span>
                    </span>
                    <span className="mt-1 text-xs leading-snug text-muted-foreground">·</span>
                    <span className="mt-1 truncate text-xs leading-snug text-foreground">
                      {r.country ?? "—"}
                    </span>
                    <span className="mt-1" aria-hidden="true" />
                  </div>

                  {/* Line 3: five red/green logistics indicators. */}
                  <div className="mt-2 flex items-center gap-1.5">
                    {indicators.map((i) => (
                      <StatusDot
                        key={i.label}
                        icon={i.icon}
                        ok={i.ok}
                        labelOk={i.label}
                        labelMissing={i.label + " — не вказано"}
                      />
                    ))}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <EditDialog
          row={editing}
          managerName={resolveManagerName(editing, managerMap) ?? undefined}
          open
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );

}


function StatusDot({
  icon: Icon,
  ok,
  labelOk,
  labelMissing,
}: {
  icon: React.ComponentType<{ className?: string }>;
  ok: boolean;
  labelOk: string;
  labelMissing: string;
}) {
  return (
    <span
      title={ok ? labelOk : labelMissing}
      aria-label={ok ? labelOk : labelMissing}
      className={cn(
        "inline-flex h-[19px] w-[19px] items-center justify-center rounded-full transition-colors",
        ok
          ? "bg-emerald-500 text-white dark:bg-emerald-600"
          : "bg-red-500 text-white dark:bg-red-600",
      )}
    >
      <Icon className="h-[11px] w-[11px]" />
    </span>
  );
}

function EditDialog({
  row,
  managerName,
  open,
  onClose,
}: {
  row: LogisticsRow;
  managerName?: string;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const isAdmin = hasRole(["admin", "super_admin"]);
  const isManager = isAdmin || hasRole("import_manager");
  const isLogistics = isAdmin || hasRole("logistics");

  const initialPickups = useMemo(() => {
    const addrs = (row.loading_address ?? "").split(/\n+/).map((s) => s.trim());
    const refs = (row.loading_reference ?? "").split(/\n+/).map((s) => s.trim());
    const n = Math.max(addrs.length, refs.length, 1);
    const out: Array<{ address: string; reference: string }> = [];
    for (let i = 0; i < n; i++) out.push({ address: addrs[i] ?? "", reference: refs[i] ?? "" });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id]);

  const initialForm = useMemo(() => ({
    tractor_plate: row.tractor_plate ?? "",
    trailer_plate: row.trailer_plate ?? "",
    driver_name: row.driver_name ?? "",
    driver_phone: row.driver_phone ?? "",
    logistics_status: row.logistics_status,
    temperature_mode: row.temperature_mode ?? "",
    eta: row.eta ?? "",
    final_freight_amount:
      row.final_freight_amount != null ? String(row.final_freight_amount) : "",
    final_freight_currency: row.final_freight_currency ?? row.logistics_cost_currency ?? "EUR",
    final_freight_payment: row.final_freight_payment ?? "bank",
    logistics_comment: row.logistics_comment ?? "",
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [row.id]);

  const [pickups, setPickups] = useState(initialPickups);
  const [form, setForm] = useState(initialForm);

  // Dirty-state: compare trimmed/normalized current values against the snapshot
  // captured when the dialog opened. Save is enabled only when a real change exists.
  // Reverting a field back to its initial value disables Save again.
  const normPickups = (arr: Array<{ address: string; reference: string }>) =>
    JSON.stringify(arr.map((p) => ({ a: p.address.trim(), r: p.reference.trim() })));
  const normForm = (f: typeof initialForm) => ({
    tractor_plate: f.tractor_plate.trim(),
    trailer_plate: f.trailer_plate.trim(),
    driver_name: f.driver_name.trim(),
    driver_phone: f.driver_phone.trim(),
    logistics_status: f.logistics_status,
    temperature_mode: f.temperature_mode.trim(),
    eta: f.eta.trim(),
    final_freight_amount: f.final_freight_amount.trim(),
    final_freight_currency: f.final_freight_currency,
    final_freight_payment: f.final_freight_payment,
    logistics_comment: f.logistics_comment.trim(),
  });
  const isDirty =
    JSON.stringify(normForm(form)) !== JSON.stringify(normForm(initialForm)) ||
    normPickups(pickups) !== normPickups(initialPickups);

  const totalPallets = row.items.reduce((s, i) => s + (Number(i.pallet_count) || 0), 0);
  const totalWeight = row.items.reduce((s, i) => {
    const g = Number(i.gross_weight_kg) || 0;
    return s + (g > 0 ? g : (Number(i.pallet_count) || 0) * (Number(i.pallet_weight) || 0));
  }, 0);

  // Temperature: a signed decimal, optionally followed by a range to a second signed decimal.
  // Accepts '+' / '-' anywhere a number begins, '.' or ',' as decimal, and '...' or '…' as range.
  const TEMP_NUM = "[+\\-]?\\d+(?:[.,]\\d+)?";
  const TEMP_RE = new RegExp(`^${TEMP_NUM}(?:(?:\\.{3}|…)${TEMP_NUM})?$`);
  const tempValid = form.temperature_mode.trim() === "" || TEMP_RE.test(form.temperature_mode.trim());

  const save = useMutation({
    mutationFn: async () => {
      if (!tempValid) {
        throw new Error("Невірний формат температури (приклади: +4, -2, +6.5)");
      }
      const patch: Record<string, unknown> = {};
      const cleanPickups = pickups.map((p) => ({ address: p.address.trim(), reference: p.reference.trim() }));
      const joinedAddress = cleanPickups.map((p) => p.address).filter(Boolean).join("\n");
      const joinedRef = cleanPickups.map((p) => p.reference).filter(Boolean).join("\n");
      if (isManager) {
        patch.loading_address = joinedAddress || null;
        patch.loading_reference = joinedRef || null;
        patch.temperature_mode = form.temperature_mode || null;
      }

      const amtStr = form.final_freight_amount.trim();
      const amtNum = amtStr === "" ? null : Number(amtStr);
      const freightChanged =
        (row.final_freight_amount ?? null) !== amtNum ||
        (row.final_freight_currency ?? null) !== (amtNum == null ? null : form.final_freight_currency) ||
        (row.final_freight_payment ?? null) !== (amtNum == null ? null : form.final_freight_payment);
      // Patch 8B: route final freight commit through lock_final_freight RPC.
      const shouldLockFreight =
        isLogistics &&
        amtNum != null &&
        amtNum > 0 &&
        !!form.final_freight_currency &&
        (freightChanged || row.final_freight_locked_at == null);

      if (isLogistics) {
        patch.tractor_plate = form.tractor_plate || null;
        patch.trailer_plate = form.trailer_plate || null;
        patch.driver_name = form.driver_name || null;
        patch.driver_phone = form.driver_phone || null;
        patch.eta = form.eta || null;
        patch.logistics_comment = form.logistics_comment || null;
        // When RPC will be called, exclude final_freight_* and logistics_cost*
        // from the direct UPDATE — the RPC owns those side effects.
        if (!shouldLockFreight) {
          patch.final_freight_amount = amtNum;
          patch.final_freight_currency = amtNum == null ? null : form.final_freight_currency;
          patch.final_freight_payment = amtNum == null ? null : form.final_freight_payment;
        }

        // Auto-compute status from filled fields. Only override early states;
        // don't touch later ones like loading/in_transit/at_customs/delayed/arrived.
        const hasVehicle = !!(form.tractor_plate.trim() && form.trailer_plate.trim());
        const hasDriver = !!form.driver_name.trim();
        const hasFreight = amtStr !== "";
        const hasAddress = !!joinedAddress;
        const hasRef = !!joinedRef;
        const earlyStates: LogisticsStatus[] = [
          "pending_planning",
          "planning",
          "vehicle_assigned",
          "ready_for_loading",
        ];
        let nextStatus: LogisticsStatus = form.logistics_status;
        if (earlyStates.includes(form.logistics_status)) {
          if (hasVehicle && hasDriver && hasFreight && hasAddress && hasRef) {
            nextStatus = "ready_for_loading";
          } else if (hasVehicle && hasDriver && hasFreight) {
            nextStatus = "vehicle_assigned";
          } else {
            nextStatus = "pending_planning";
          }
        }
        patch.logistics_status = nextStatus;
      } else if (isManager) {
        // Manager (without logistics role) may also change status. No auto-status logic.
        patch.logistics_status = form.logistics_status;
      }

      if (Object.keys(patch).length > 0) {
        // .select("id") forces PostgREST to return affected rows so we can
        // detect a "no-op" save caused by RLS silently filtering the UPDATE.
        // Without this check, error===null + 0 affected rows would fire a
        // false "Збережено" toast.
        const { data: updated, error } = await (supabase as any)
          .from("shipments")
          .update(patch)
          .eq("id", row.id)
          .select("id");
        if (error) throw error;
        if (!updated || (updated as { id: string }[]).length === 0) {
          throw new Error("Зміни не збережено: немає прав на оновлення цієї поставки.");
        }
      }

      if (shouldLockFreight) {
        const { error } = await (supabase as any).rpc("lock_final_freight", {
          p_shipment_id: row.id,
          p_amount: amtNum,
          p_currency: form.final_freight_currency,
          p_payment: form.final_freight_payment,
        });
        if (error) throw new Error("FREIGHT_LOCK_FAILED:" + error.message);
      }
    },
    onSuccess: () => {
      toast.success("Збережено");
      qc.invalidateQueries({ queryKey: ["logistics-board"] });
      qc.invalidateQueries({ queryKey: ["branch-visible-prices"] });
      qc.invalidateQueries({ queryKey: ["branch-baselines"] });
      qc.invalidateQueries({ queryKey: ["branch-incoming-items-v3"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      onClose();
    },
    onError: (e: Error) => {
      if (e.message.startsWith("FREIGHT_LOCK_FAILED:")) {
        toast.error("Інші зміни збережено, але фінальний фрахт не зафіксовано. Спробуйте ще раз.");
        qc.invalidateQueries({ queryKey: ["logistics-board"] });
        // Keep dialog open so user can retry with the same freight values.
      } else {
        toast.error(e.message);
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader className="pr-8">
          <DialogTitle className="text-sm font-mono">{row.code}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          {/* Summary block — manager, supplier, dates, pallets, products.
              Sits below the title so the dialog close (X) cannot overlap any data. */}
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-[11px] space-y-2">
            {/* Top-left status chip removed by design: status lives lower in the form
                as a reserved control. Top row shows manager + pallets/weight only. */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 text-[11px]">
                <span className="text-muted-foreground">Менеджер: </span>
                <span className="font-bold text-foreground">{managerName ?? "—"}</span>
              </div>
              <div className="shrink-0 text-right text-[11px] font-bold tabular-nums text-foreground">
                {totalPallets || 0}п
                {totalWeight ? ` · ${Math.round(totalWeight)} кг` : ""}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              <div className="truncate"><span className="text-muted-foreground">Постачальник: </span><span className="font-semibold text-foreground">{row.supplier?.name ?? "—"}</span></div>
              <div className="truncate"><span className="text-muted-foreground">Країна: </span><span className="font-semibold text-foreground">{row.country ?? "—"}</span></div>
              <div className="truncate">
                <span className="font-semibold text-sky-600 dark:text-sky-300">ETD </span>
                <span className="font-semibold text-foreground">{fmtShort(row.loading_date)}</span>
              </div>
              <div className="truncate">
                <span className="font-semibold text-sky-600 dark:text-sky-300">ETA </span>
                <span className="font-semibold text-foreground">{fmtShort(row.eta)}</span>
              </div>
            </div>
            {row.items.length > 0 && (
              <div className="border-t border-border/60 pt-1.5 text-[11px] text-muted-foreground">
                {row.items.map((it, i) => {
                  const gross = Number(it.gross_weight_kg);
                  const showGross = Number.isFinite(gross) && gross > 0;
                  return (
                    <div key={i} className="truncate">
                      • {it.product_name}
                      {it.pallet_count ? ` — ${it.pallet_count} пал.` : ""}
                      {showGross ? ` · ${Math.round(gross)} кг` : ""}
                      {it.origin_country ? ` · ${it.origin_country}` : ""}
                    </div>
                  );
                })}
              </div>
            )}
          </div>


          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase text-muted-foreground">
              <FileText className="h-3 w-3" /> Менеджер
            </h3>
            <div className="grid gap-2">
              <div className="space-y-2">
                {pickups.map((p, idx) => (
                  <div key={idx} className="rounded-md border border-border/60 bg-muted/20 p-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Точка завантаження {pickups.length > 1 ? `#${idx + 1}` : ""}
                      </span>
                      {isManager && pickups.length > 1 && (
                        <button
                          type="button"
                          className="text-[10px] font-semibold text-destructive hover:underline"
                          onClick={() => setPickups(pickups.filter((_, i) => i !== idx))}
                        >
                          Видалити
                        </button>
                      )}
                    </div>
                    <Labeled label="Адреса завантаження">
                      <Textarea
                        value={p.address}
                        onChange={(e) => {
                          const next = [...pickups];
                          next[idx] = { ...next[idx], address: e.target.value };
                          setPickups(next);
                        }}
                        rows={3}
                        disabled={!isManager}
                        className="min-h-[68px]"
                      />
                    </Labeled>
                    <Labeled label="Loading reference">
                      <Input
                        value={p.reference}
                        onChange={(e) => {
                          const next = [...pickups];
                          next[idx] = { ...next[idx], reference: e.target.value };
                          setPickups(next);
                        }}
                        disabled={!isManager}
                      />
                    </Labeled>
                  </div>
                ))}
                {isManager && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setPickups([...pickups, { address: "", reference: "" }])}
                  >
                    + Додати точку завантаження
                  </Button>
                )}
              </div>
              <Labeled label="Температура">
                <div className="flex items-stretch gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      const cur = form.temperature_mode;
                      let next: string;
                      if (cur.startsWith("+")) next = "-" + cur.slice(1);
                      else if (cur.startsWith("-")) next = "+" + cur.slice(1);
                      else next = "+" + cur;
                      setForm({ ...form, temperature_mode: next });
                    }}
                    disabled={!isManager}
                    aria-label="Перемкнути знак"
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input bg-transparent text-base font-bold shadow-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    ±
                  </button>
                  <Input
                    value={form.temperature_mode}
                    onChange={(e) => {
                      // Allow digits, +, -, '.', ',', and range separator '…'/'...'.
                      const filtered = e.target.value.replace(/[^0-9+\-.,…]/g, "");
                      setForm({ ...form, temperature_mode: filtered });
                    }}
                    type="text"
                    inputMode="text"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    disabled={!isManager}
                    placeholder="+2…+6"
                    aria-invalid={!tempValid}
                    className={cn("flex-1", !tempValid && "border-destructive focus-visible:ring-destructive")}
                  />
                </div>
                {!tempValid && (
                  <p className="mt-1 text-[10px] font-medium text-destructive">
                    Лише цифри, +, -, кома/крапка. Приклад: +4, -2, +6.5, +2...+6
                  </p>
                )}
              </Labeled>
              <Labeled label="Орієнтовний фрахт (від менеджера)">
                <div className="rounded-md border border-dashed border-border bg-muted/30 px-2 py-1.5 text-xs">
                  {row.logistics_cost != null && Number(row.logistics_cost) > 0 ? (
                    <span className="font-semibold">
                      {Number(row.logistics_cost).toFixed(2)} {row.logistics_cost_currency ?? "EUR"}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">не вказано</span>
                  )}
                </div>
              </Labeled>
            </div>
          </section>

          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase text-muted-foreground">
              <Truck className="h-3 w-3" /> Логіст
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <Labeled label="Тягач">
                <Input
                  value={form.tractor_plate}
                  onChange={(e) => setForm({ ...form, tractor_plate: e.target.value })}
                  disabled={!isLogistics}
                  placeholder="AA1113TT"
                  autoCapitalize="characters"
                />
              </Labeled>
              <Labeled label="Причіп">
                <Input
                  value={form.trailer_plate}
                  onChange={(e) => setForm({ ...form, trailer_plate: e.target.value })}
                  disabled={!isLogistics}
                  placeholder="AX3111PC"
                  autoCapitalize="characters"
                />
              </Labeled>
              <Labeled label="Водій">
                <Input
                  value={form.driver_name}
                  onChange={(e) => setForm({ ...form, driver_name: e.target.value })}
                  disabled={!isLogistics}
                />
              </Labeled>
              <Labeled label="Телефон">
                <Input
                  value={form.driver_phone}
                  onChange={(e) => {
                    // Allow only digits and a leading '+'.
                    const raw = e.target.value;
                    const hasPlus = raw.trimStart().startsWith("+");
                    const digits = raw.replace(/\D/g, "");
                    setForm({ ...form, driver_phone: (hasPlus ? "+" : "") + digits });
                  }}
                  inputMode="tel"
                  disabled={!isLogistics}
                  placeholder="+380…"
                />
              </Labeled>
              <Labeled label="ETA (прибуття)">
                <Input
                  type="date"
                  value={form.eta}
                  onChange={(e) => setForm({ ...form, eta: e.target.value })}
                  disabled={!isLogistics}
                />
              </Labeled>
              <Labeled label="Фінальна вартість транспорту">
                <div className="flex gap-1">
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={form.final_freight_amount}
                    onChange={(e) => setForm({ ...form, final_freight_amount: e.target.value })}
                    disabled={!isLogistics}
                    placeholder="0"
                    className="flex-1"
                  />
                  <Select
                    value={form.final_freight_currency}
                    onValueChange={(v) => setForm({ ...form, final_freight_currency: v })}
                    disabled={!isLogistics}
                  >
                    <SelectTrigger className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="EUR">EUR</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="UAH">UAH</SelectItem>
                      <SelectItem value="PLN">PLN</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </Labeled>
              <Labeled label="Спосіб оплати">
                <Select
                  value={form.final_freight_payment}
                  onValueChange={(v) => setForm({ ...form, final_freight_payment: v })}
                  disabled={!isLogistics}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">гот.</SelectItem>
                    <SelectItem value="bank">б.р.</SelectItem>
                  </SelectContent>
                </Select>
              </Labeled>
              <Labeled label="Статус" className="sm:col-span-2">
                <Select
                  value={form.logistics_status}
                  onValueChange={(v) => setForm({ ...form, logistics_status: v as LogisticsStatus })}
                  disabled={!isLogistics && !isManager}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(LOGISTICS_STATUS_LABEL) as LogisticsStatus[]).map((s) => (
                      <SelectItem key={s} value={s}>
                        {LOGISTICS_STATUS_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Labeled>
              <Labeled label="Коментар логіста" className="sm:col-span-2">
                <Textarea
                  value={form.logistics_comment}
                  onChange={(e) => setForm({ ...form, logistics_comment: e.target.value })}
                  rows={3}
                  disabled={!isLogistics}
                  className="min-h-[68px]"
                />
              </Labeled>
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button
            onClick={() => {
              // Dirty-save guard: never call mutation on no-op.
              if (!isDirty || save.isPending) return;
              save.mutate();
            }}
            disabled={!isDirty || !tempValid || save.isPending}
          >
            <Save className="mr-1 h-4 w-4" /> Зберегти
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Labeled({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

function SummaryTable({ rows }: { rows: LogisticsRow[] }) {
  const data = rows
    .map((r) => ({
      id: r.id,
      code: r.code,
      plate:
        [r.tractor_plate, r.trailer_plate].filter(Boolean).join(" / ") ||
        r.vehicle_plate ||
        "—",
      amount: r.final_freight_amount,
      currency: r.final_freight_currency,
      payment: r.final_freight_payment,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));

  if (data.length === 0) {
    return <EmptyState title="Порожньо" hint="Немає поставок для підсумку." />;
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="font-semibold text-foreground">№ поставки</TableHead>
            <TableHead className="font-semibold text-foreground">№ авто</TableHead>
            <TableHead className="text-right font-semibold text-foreground">Вартість</TableHead>
            <TableHead className="font-semibold text-foreground">Валюта</TableHead>
            <TableHead className="font-semibold text-foreground">Оплата</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-mono text-xs">{r.code}</TableCell>
              <TableCell className="font-mono text-xs">{r.plate}</TableCell>
              <TableCell className="text-right tabular-nums">
                {r.amount != null ? Number(r.amount).toFixed(0) : "—"}
              </TableCell>
              <TableCell className="text-xs">{r.currency ?? "—"}</TableCell>
              <TableCell className="text-xs">
                {r.payment === "cash" ? "гот." : r.payment === "bank" ? "б.р." : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Truck, FileText, Save, AlertTriangle, Search, Wallet } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  LOGISTICS_STATUS_LABEL,
  LOGISTICS_STATUS_CLASS,
  LOGISTICS_FILTER_LABEL,
  LOGISTICS_FILTER_STATUSES,
  type LogisticsStatus,
  type LogisticsFilter,
} from "@/lib/logistics";
import { MainBoardToggle, type BoardView } from "@/components/MainBoardToggle";

export const Route = createFileRoute("/_authenticated/logistics")({
  component: LogisticsGate,
});

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
  temperature_mode: string | null;
  supplier: { name: string | null; import_manager_id: string | null } | null;
  import_manager_id: string | null;
  items: Array<{
    product_name: string;
    pallet_count: number | null;
    pallet_weight: number | null;
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
  const [filter, setFilter] = useState<LogisticsFilter>("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<LogisticsRow | null>(null);
  const [board, setBoard] = useState<BoardView>("active");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["logistics-board"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("shipments")
        .select(
          `id, code, status, logistics_status, loading_date, eta, country,
           unloaded_at, archived_at,
           loading_address, loading_reference, driver_name, driver_phone,
           vehicle_plate, tractor_plate, trailer_plate,
           notes, logistics_comment, loading_started_at, loading_ended_at,
           logistics_cost, logistics_cost_currency,
           final_freight_amount, final_freight_currency,
           temperature_mode,
           import_manager_id,
           supplier:suppliers(name, import_manager_id),
           items:shipment_items(product_name, pallet_count, pallet_weight, origin_country)`,
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

  const counts = useMemo(() => {
    const c: Record<LogisticsFilter, number> = {
      all: rows.length,
      incoming: 0,
      assigned: 0,
      loading: 0,
      transit: 0,
    };
    for (const r of rows) {
      for (const f of ["incoming", "assigned", "loading", "transit"] as LogisticsFilter[]) {
        const list = LOGISTICS_FILTER_STATUSES[f];
        if (list && list.includes(r.logistics_status)) c[f]++;
      }
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const list = LOGISTICS_FILTER_STATUSES[filter];
    let out = list ? rows.filter((r) => list.includes(r.logistics_status)) : rows;
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter((r) =>
        [
          r.code,
          r.supplier?.name ?? "",
          r.country ?? "",
          r.vehicle_plate ?? "",
          r.tractor_plate ?? "",
          r.trailer_plate ?? "",
          r.driver_name ?? "",
          resolveManagerName(r, managerMap) ?? "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    return out;
  }, [rows, filter, search, managerMap]);

  return (
    <div>
      <PageHeader
        title="Логістика"
        subtitle="Єдине табло поставок з номером, постачальником та позиціями. Клікніть рядок для деталей."
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(Object.keys(LOGISTICS_FILTER_LABEL) as LogisticsFilter[]).map((f) => {
          const active = filter === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted",
              )}
            >
              {LOGISTICS_FILTER_LABEL[f]}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10px]",
                  active ? "bg-primary-foreground/20" : "bg-secondary",
                )}
              >
                {counts[f]}
              </span>
            </button>
          );
        })}

        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Пошук: код, постачальник, авто, водій…"
            className="h-8 w-64 pl-7 text-xs"
          />
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Завантаження…</p>
      ) : filtered.length === 0 ? (
        <EmptyState title="Порожньо" hint="Немає поставок для обраного фільтру." />
      ) : (
        <BoardTable
          rows={filtered}
          managerMap={managerMap}
          onOpen={(r) => setEditing(r)}
        />
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

function BoardTable({
  rows,
  managerMap,
  onOpen,
}: {
  rows: LogisticsRow[];
  managerMap: Record<string, string>;
  onOpen: (r: LogisticsRow) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Код</TableHead>
              <TableHead className="text-xs">Статус</TableHead>
              <TableHead className="text-xs">Завантаження</TableHead>
              <TableHead className="text-xs">ETA</TableHead>
              <TableHead className="text-xs">Постачальник</TableHead>
              <TableHead className="text-xs">Країна</TableHead>
              <TableHead className="text-xs">Темп.</TableHead>
              <TableHead className="text-xs text-right">Палет</TableHead>
              <TableHead className="text-xs text-right">Вага, кг</TableHead>
              <TableHead className="text-xs">Авто</TableHead>
              <TableHead className="text-xs">Водій</TableHead>
              <TableHead className="text-xs">Менеджер</TableHead>
              <TableHead className="text-xs">Freight</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const totalPallets = r.items.reduce((s, i) => s + (Number(i.pallet_count) || 0), 0);
              const totalWeight = r.items.reduce(
                (s, i) => s + (Number(i.pallet_count) || 0) * (Number(i.pallet_weight) || 0),
                0,
              );
              const missingAddress = !r.loading_address;
              const missingRef = !r.loading_reference;
              const missingVehicle = !r.tractor_plate && !r.vehicle_plate;
              const missingDriver = !r.driver_name;
              const missingFinalFreight = r.final_freight_amount == null;
              const missingTemperature = !r.temperature_mode;
              const hasWarnings =
                missingVehicle || missingDriver || missingAddress || missingRef || missingFinalFreight || missingTemperature;
              const tractor = r.tractor_plate ?? r.vehicle_plate ?? null;
              const trailer = r.trailer_plate ?? null;
              const managerLabel = resolveManagerName(r, managerMap);
              return (
                <Fragment key={r.id}>
                  {hasWarnings && (
                    <TableRow
                      className="cursor-pointer border-b-0 hover:bg-muted/40"
                      onClick={() => onOpen(r)}
                    >
                      <TableCell colSpan={13} className="px-2 py-1">
                        <div className="flex flex-wrap items-center gap-1">
                          {missingVehicle && <Warning text="без авто" />}
                          {missingDriver && <Warning text="без водія" />}
                          {missingAddress && <Warning text="без адреси" />}
                          {missingRef && <Warning text="без reference" />}
                          {missingFinalFreight && <Warning text="без final freight" />}
                          {missingTemperature && <Warning text="без температури" />}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  <TableRow
                    className="cursor-pointer [&_td]:py-1"
                    onClick={() => onOpen(r)}
                  >
                    <TableCell className="font-mono text-xs font-bold">{r.code}</TableCell>
                    <TableCell>
                      {r.logistics_status === "pending_planning" ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <span
                          className={cn(
                            "inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold",
                            LOGISTICS_STATUS_CLASS[r.logistics_status],
                          )}
                        >
                          {LOGISTICS_STATUS_LABEL[r.logistics_status]}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{r.loading_date ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.eta ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.supplier?.name ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.country ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      {r.temperature_mode === "cold" ? (
                        <span className="inline-block rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-900 dark:bg-sky-900/40 dark:text-sky-200">
                          Холод
                        </span>
                      ) : r.temperature_mode === "warm" ? (
                        <span className="inline-block rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-900 dark:bg-orange-900/40 dark:text-orange-200">
                          Тепло
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs">{totalPallets || "—"}</TableCell>
                    <TableCell className="text-right text-xs">
                      {totalWeight ? Math.round(totalWeight) : "—"}
                    </TableCell>
                    <TableCell className="text-xs font-mono whitespace-nowrap">
                      {tractor ? (
                        <span>
                          {tractor}
                          {trailer ? <span className="text-muted-foreground"> / {trailer}</span> : null}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{r.driver_name ?? "—"}</TableCell>
                    <TableCell className="text-xs">{managerLabel ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      {r.final_freight_amount != null ? (
                        <span className="font-semibold text-foreground">
                          {Number(r.final_freight_amount).toFixed(0)}{" "}
                          {r.final_freight_currency ?? "EUR"}
                        </span>
                      ) : r.logistics_cost ? (
                        <span className="text-muted-foreground">
                          ~{Number(r.logistics_cost).toFixed(0)} {r.logistics_cost_currency ?? "EUR"}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function Warning({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
      <AlertTriangle className="h-2.5 w-2.5" />
      {text}
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

  const [form, setForm] = useState({
    loading_address: row.loading_address ?? "",
    loading_reference: row.loading_reference ?? "",
    tractor_plate: row.tractor_plate ?? "",
    trailer_plate: row.trailer_plate ?? "",
    driver_name: row.driver_name ?? "",
    driver_phone: row.driver_phone ?? "",
    eta: row.eta ?? "",
    notes: row.notes ?? "",
    logistics_comment: row.logistics_comment ?? "",
    logistics_status: row.logistics_status,
    final_freight_amount:
      row.final_freight_amount != null ? String(row.final_freight_amount) : "",
    final_freight_currency: row.final_freight_currency ?? "EUR",
    temperature_mode: row.temperature_mode ?? "",
  });

  const save = useMutation({
    mutationFn: async () => {
      const patch: Record<string, unknown> = {};
      if (isManager) {
        patch.loading_address = form.loading_address || null;
        patch.loading_reference = form.loading_reference || null;
        patch.notes = form.notes || null;
        patch.temperature_mode = form.temperature_mode || null;
      }
      if (isLogistics) {
        patch.tractor_plate = form.tractor_plate || null;
        patch.trailer_plate = form.trailer_plate || null;
        patch.driver_name = form.driver_name || null;
        patch.driver_phone = form.driver_phone || null;
        patch.eta = form.eta || null;
        patch.logistics_status = form.logistics_status;
        patch.logistics_comment = form.logistics_comment || null;
        const finalNum = form.final_freight_amount.trim()
          ? Number(form.final_freight_amount.replace(",", "."))
          : null;
        if (finalNum !== null && Number.isNaN(finalNum)) {
          throw new Error("Невірна сума final freight");
        }
        patch.final_freight_amount = finalNum;
        patch.final_freight_currency = finalNum != null ? form.final_freight_currency : null;
      }
      if (Object.keys(patch).length === 0) return;
      const { error } = await (supabase as any).from("shipments").update(patch).eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Збережено");
      qc.invalidateQueries({ queryKey: ["logistics-board"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startLoading = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any)
        .from("shipments")
        .update({
          logistics_status: "loading",
          loading_started_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Завантаження розпочато");
      qc.invalidateQueries({ queryKey: ["logistics-board"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const finishLoading = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any)
        .from("shipments")
        .update({
          logistics_status: "in_transit",
          status: "in_transit",
          loading_ended_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Поставка в дорозі");
      qc.invalidateQueries({ queryKey: ["logistics-board"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const estimatedFreight = row.logistics_cost;
  const estimatedCurrency = row.logistics_cost_currency ?? "EUR";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono">{row.code}</span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                LOGISTICS_STATUS_CLASS[row.logistics_status],
              )}
            >
              {LOGISTICS_STATUS_LABEL[row.logistics_status]}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase text-muted-foreground">
              <FileText className="h-3 w-3" /> Менеджер: завантаження
            </h3>
            <div className="grid gap-2 md:grid-cols-2">
              <Labeled label="Loading address">
                <Textarea
                  value={form.loading_address}
                  onChange={(e) => setForm({ ...form, loading_address: e.target.value })}
                  rows={2}
                  disabled={!isManager}
                />
              </Labeled>
              <Labeled label="Loading reference">
                <Input
                  value={form.loading_reference}
                  onChange={(e) => setForm({ ...form, loading_reference: e.target.value })}
                  disabled={!isManager}
                />
              </Labeled>
              <Labeled label="Температура перевезення">
                <Select
                  value={form.temperature_mode || "none"}
                  onValueChange={(v) =>
                    setForm({ ...form, temperature_mode: v === "none" ? "" : v })
                  }
                  disabled={!isManager}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Оберіть режим" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— не вказано —</SelectItem>
                    <SelectItem value="cold">Холод</SelectItem>
                    <SelectItem value="warm">Тепло</SelectItem>
                  </SelectContent>
                </Select>
              </Labeled>
            </div>
          </section>

          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase text-muted-foreground">
              <Truck className="h-3 w-3" /> Логістика: авто та водій
            </h3>
            <div className="grid gap-2 md:grid-cols-2">
              <Labeled label="Номер тягача">
                <Input
                  value={form.tractor_plate}
                  onChange={(e) => setForm({ ...form, tractor_plate: e.target.value })}
                  disabled={!isLogistics}
                  placeholder="напр. AA1113TT"
                  autoCapitalize="characters"
                />
              </Labeled>
              <Labeled label="Номер причепа">
                <Input
                  value={form.trailer_plate}
                  onChange={(e) => setForm({ ...form, trailer_plate: e.target.value })}
                  disabled={!isLogistics}
                  placeholder="напр. AX3111PC"
                  autoCapitalize="characters"
                />
              </Labeled>
              <Labeled label="ETA">
                <Input
                  type="date"
                  value={form.eta}
                  onChange={(e) => setForm({ ...form, eta: e.target.value })}
                  disabled={!isLogistics}
                />
              </Labeled>
              <Labeled label="Водій">
                <Input
                  value={form.driver_name}
                  onChange={(e) => setForm({ ...form, driver_name: e.target.value })}
                  disabled={!isLogistics}
                />
              </Labeled>
              <Labeled label="Телефон водія">
                <Input
                  value={form.driver_phone}
                  onChange={(e) => setForm({ ...form, driver_phone: e.target.value })}
                  disabled={!isLogistics}
                />
              </Labeled>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Заповнення номера авто автоматично переведе статус у «Авто призначено».
            </p>
          </section>

          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase text-muted-foreground">
              <Wallet className="h-3 w-3" /> Вартість транспорту
            </h3>
            <div className="rounded-md border border-border/50 bg-muted/30 p-2 text-xs">
              <div>
                <span className="text-muted-foreground">Estimated (менеджер):</span>{" "}
                <span className="font-semibold">
                  {estimatedFreight && row.final_freight_amount == null
                    ? `${Number(estimatedFreight).toFixed(2)} ${estimatedCurrency}`
                    : "—"}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Final freight має пріоритет над estimated.
              </p>
            </div>
            <div className="mt-2 grid gap-2 md:grid-cols-[1fr_120px]">
              <Labeled label="Final freight (фактична)">
                <Input
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={form.final_freight_amount}
                  onChange={(e) => setForm({ ...form, final_freight_amount: e.target.value })}
                  disabled={!isLogistics}
                  placeholder="напр. 2600"
                />
              </Labeled>
              <Labeled label="Валюта">
                <Select
                  value={form.final_freight_currency}
                  onValueChange={(v) => setForm({ ...form, final_freight_currency: v })}
                  disabled={!isLogistics}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["EUR", "USD", "UAH", "PLN"].map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Labeled>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-bold uppercase text-muted-foreground">
              Статус та коментарі
            </h3>
            <div className="grid gap-2 md:grid-cols-2">
              <Labeled label="Logistics status">
                <Select
                  value={form.logistics_status}
                  onValueChange={(v) => setForm({ ...form, logistics_status: v as LogisticsStatus })}
                  disabled={!isLogistics}
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
            </div>
            <Labeled label="Logistics коментар (логіст)" className="mt-2">
              <Textarea
                value={form.logistics_comment}
                onChange={(e) => setForm({ ...form, logistics_comment: e.target.value })}
                rows={2}
                disabled={!isLogistics}
              />
            </Labeled>
            <Labeled label="Manager коментар / loading instructions" className="mt-2">
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                disabled={!isManager}
              />
            </Labeled>
          </section>

          <section className="rounded-lg border border-border/50 bg-muted/30 p-2 text-xs">
            <div className="grid gap-1 md:grid-cols-2">
              <div>
                <span className="text-muted-foreground">Постачальник:</span>{" "}
                <span className="font-medium">{row.supplier?.name ?? "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Країна:</span>{" "}
                <span className="font-medium">{row.country ?? "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Дата завантаження:</span>{" "}
                <span className="font-medium">{row.loading_date ?? "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Менеджер:</span>{" "}
                <span className="font-medium">{managerName ?? "—"}</span>
              </div>
            </div>
            {row.items.length > 0 && (
              <div className="mt-2 border-t border-border/50 pt-2">
                {row.items.map((i, idx) => (
                  <div key={idx} className="text-[11px]">
                    {i.product_name} — {i.pallet_count ?? 0} пал · {i.origin_country ?? "—"}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {isLogistics && row.logistics_status === "vehicle_assigned" && (
            <Button
              variant="secondary"
              onClick={() => startLoading.mutate()}
              disabled={startLoading.isPending}
            >
              Розпочати завантаження
            </Button>
          )}
          {isLogistics && row.logistics_status === "loading" && (
            <Button
              variant="secondary"
              onClick={() => finishLoading.mutate()}
              disabled={finishLoading.isPending}
            >
              Завантаження завершено → В дорозі
            </Button>
          )}
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
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

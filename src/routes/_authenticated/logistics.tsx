import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Truck, FileText, Save, AlertTriangle, Search } from "lucide-react";
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
  final_freight_payment: string | null;
  temperature_mode: string | null;
  supplier: { name: string | null; import_manager_id: string | null } | null;
  import_manager_id: string | null;
  unloaded_at: string | null;
  archived_at: string | null;
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
           final_freight_amount, final_freight_currency, final_freight_payment,
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
    out = out.filter((r) => {
      if (r.archived_at) return false;
      if (board === "unloaded") return !!r.unloaded_at && r.status !== "cancelled";
      return !r.unloaded_at && r.status !== "cancelled";
    });
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

      <div className="mb-3"><MainBoardToggle value={board} onChange={setBoard} showSummary /></div>

      {board !== "summary" && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {board === "active" && (Object.keys(LOGISTICS_FILTER_LABEL) as LogisticsFilter[]).map((f) => {
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
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Завантаження…</p>
      ) : board === "summary" ? (
        <SummaryTable rows={rows.filter((r) => !r.archived_at && r.status !== "cancelled")} />
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
      <div className="w-full">
        <table className="w-full caption-bottom text-sm">
          <TableHeader className="sticky top-16 z-20 backdrop-blur shadow-[0_1px_0_0_hsl(var(--border))] [&_th]:bg-table-head [&_th]:font-bold">
            <TableRow className="hover:bg-transparent">
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
              const missingTemperature = !r.temperature_mode;
              const hasWarnings =
                missingVehicle || missingDriver || missingAddress || missingRef || missingTemperature;
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
                    <TableCell className="text-xs whitespace-nowrap">
                      {r.temperature_mode ? (
                        <span className="inline-block rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-900 dark:bg-sky-900/40 dark:text-sky-200">
                          {r.temperature_mode}
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
        </table>
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
    logistics_status: row.logistics_status,
    temperature_mode: row.temperature_mode ?? "",
    eta: row.eta ?? "",
    final_freight_amount:
      row.final_freight_amount != null ? String(row.final_freight_amount) : "",
    final_freight_currency: row.final_freight_currency ?? row.logistics_cost_currency ?? "EUR",
    final_freight_payment: row.final_freight_payment ?? "bank",
    logistics_comment: row.logistics_comment ?? "",
  });

  const totalPallets = row.items.reduce((s, i) => s + (Number(i.pallet_count) || 0), 0);
  const totalWeight = row.items.reduce(
    (s, i) => s + (Number(i.pallet_count) || 0) * (Number(i.pallet_weight) || 0),
    0,
  );

  const save = useMutation({
    mutationFn: async () => {
      const patch: Record<string, unknown> = {};
      if (isManager) {
        patch.loading_address = form.loading_address || null;
        patch.loading_reference = form.loading_reference || null;
        patch.temperature_mode = form.temperature_mode || null;
      }
      if (isLogistics) {
        patch.tractor_plate = form.tractor_plate || null;
        patch.trailer_plate = form.trailer_plate || null;
        patch.driver_name = form.driver_name || null;
        patch.driver_phone = form.driver_phone || null;
        patch.logistics_status = form.logistics_status;
        patch.eta = form.eta || null;
        patch.logistics_comment = form.logistics_comment || null;
        const amt = form.final_freight_amount.trim();
        patch.final_freight_amount = amt === "" ? null : Number(amt);
        patch.final_freight_currency = amt === "" ? null : form.final_freight_currency;
        patch.final_freight_payment = amt === "" ? null : form.final_freight_payment;
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

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <span className="font-mono">{row.code}</span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                LOGISTICS_STATUS_CLASS[row.logistics_status],
              )}
            >
              {LOGISTICS_STATUS_LABEL[row.logistics_status]}
            </span>
            {managerName ? (
              <span className="ml-auto text-[11px] font-normal text-muted-foreground">{managerName}</span>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <div className="rounded-md border border-border bg-muted/30 p-2 text-[11px]">
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              <div><span className="text-muted-foreground">Постачальник: </span>{row.supplier?.name ?? "—"}</div>
              <div><span className="text-muted-foreground">Країна: </span>{row.country ?? "—"}</div>
              <div><span className="text-muted-foreground">Завантаження: </span>{row.loading_date ?? "—"}</div>
              <div><span className="text-muted-foreground">Палет / вага: </span>{totalPallets || "—"} / {totalWeight ? Math.round(totalWeight) + " кг" : "—"}</div>
            </div>
            {row.items.length > 0 && (
              <div className="mt-1.5 border-t border-border/60 pt-1.5 text-[11px] text-muted-foreground">
                {row.items.map((it, i) => (
                  <div key={i}>
                    • {it.product_name}
                    {it.pallet_count ? ` — ${it.pallet_count} пал.` : ""}
                    {it.origin_country ? ` · ${it.origin_country}` : ""}
                  </div>
                ))}
              </div>
            )}
          </div>

          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase text-muted-foreground">
              <FileText className="h-3 w-3" /> Менеджер
            </h3>
            <div className="grid gap-2">
              <Labeled label="Адреса завантаження">
                <Textarea
                  value={form.loading_address}
                  onChange={(e) => setForm({ ...form, loading_address: e.target.value })}
                  rows={2}
                  disabled={!isManager}
                />
              </Labeled>
              <div className="grid gap-2 sm:grid-cols-2">
                <Labeled label="Loading reference">
                  <Input
                    value={form.loading_reference}
                    onChange={(e) => setForm({ ...form, loading_reference: e.target.value })}
                    disabled={!isManager}
                  />
                </Labeled>
                <Labeled label="Температура">
                  <Input
                    value={form.temperature_mode}
                    onChange={(e) => setForm({ ...form, temperature_mode: e.target.value })}
                    disabled={!isManager}
                    placeholder="+2…+6 °C"
                  />
                </Labeled>
              </div>
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
                  onChange={(e) => setForm({ ...form, driver_phone: e.target.value })}
                  disabled={!isLogistics}
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
              <Labeled label="Коментар логіста" className="sm:col-span-2">
                <Textarea
                  value={form.logistics_comment}
                  onChange={(e) => setForm({ ...form, logistics_comment: e.target.value })}
                  rows={2}
                  disabled={!isLogistics}
                />
              </Labeled>
            </div>
          </section>
        </div>

        <DialogFooter>
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

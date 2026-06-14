import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { cn } from "@/lib/utils";
import { useAuth, type AppRole } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/archive")({
  component: ArchivePage,
});

// Tropik Archive UI — first slice. Reads ONLY from role-safe views:
//   - branch_archive_results_branch
//   - branch_archive_results_manager
//   - branch_archive_results_admin
// No raw archive tables. No shipments / distributions / cancelled_shipments_archive.

type ArchiveView =
  | "branch_archive_results_branch"
  | "branch_archive_results_manager"
  | "branch_archive_results_admin";

type EventType = "delivered" | "not_fulfilled" | "refused" | "cancelled";
type UiEventType = EventType | "cut"; // 'cut' is a client-side derived row (Урізано)

interface ArchiveRow {
  result_id: string | null;
  position_id: string | null;
  event_type: EventType | null;
  delivered_qty: number | null;
  shared_qty: number | null;
  cut_qty: number | null;
  actual_eta: string | null;
  actual_cost_indicative_usd: number | null;
  actual_cost_invoice_usd: number | null;
  actual_cost_landed_usd: number | null;
  is_split_shipment: boolean | null;
  occurred_at: string | null;
  requested_qty: number | null;
  promise_eta_snapshot: string | null;
  caliber: string | null;
  packaging: string | null;
  pallet_qty: number | null;
  cost_indicative_usd_snapshot: number | null;
  cost_invoice_usd_snapshot: number | null;
  event_qty: number | null;
  product_name: string | null;
  origin_country_name: string | null;
  variety_name: string | null;
  responsible_manager_name: string | null;
  shipment_code: string | null;
}

// UI row: actual archive row + optional derived flag
interface UiRow extends ArchiveRow {
  ui_event: UiEventType;
  ui_qty: number | null; // headline qty for this row's display
  ui_eta: string | null; // ETA used for sorting/display
}

const fmtDate = (d: string | null) =>
  d
    ? new Date(d).toLocaleDateString("uk-UA", { day: "2-digit", month: "short", year: "numeric" })
    : "—";

const fmtNum = (n: number | null | undefined, digits = 0) =>
  n == null || Number.isNaN(Number(n)) ? "—" : Number(n).toLocaleString("uk-UA", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

const fmtCost = (n: number | null | undefined) =>
  n == null ? "—" : `$${fmtNum(n, 2)}`;

const costAtOrder = (r: ArchiveRow) =>
  r.cost_invoice_usd_snapshot ?? r.cost_indicative_usd_snapshot ?? null;

const actualCost = (r: ArchiveRow) =>
  r.actual_cost_invoice_usd ?? r.actual_cost_indicative_usd ?? r.actual_cost_landed_usd ?? null;

const etaForSort = (r: ArchiveRow) =>
  r.actual_eta ?? r.promise_eta_snapshot ?? r.occurred_at ?? null;

const EVENT_LABEL: Record<UiEventType, string> = {
  delivered: "Доставлено",
  not_fulfilled: "Не виконано",
  refused: "Відмова",
  cancelled: "Скасовано",
  cut: "Урізано",
};

function viewForRole(role: AppRole | null): ArchiveView | "none" {
  if (!role) return "none";
  if (role === "branch") return "branch_archive_results_branch";
  if (role === "import_manager") return "branch_archive_results_manager";
  if (role === "super_admin" || role === "admin" || role === "owner")
    return "branch_archive_results_admin";
  // logistics, calendar_*, broker (if exists) → no access
  return "none";
}

type Tab = "done" | "notdone";
type EventFilter = "all" | UiEventType;

function ArchivePage() {
  const { primaryRole } = useAuth();
  const view = viewForRole(primaryRole);
  const [tab, setTab] = useState<Tab>("done");
  const [productFilter, setProductFilter] = useState<string>("");
  const [countryFilter, setCountryFilter] = useState<string>("");
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const {
    data: rawRows = [],
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["tropik-archive", view],
    enabled: view !== "none",
    queryFn: async () => {
      // P1 stabilization: server-side order by occurred_at desc + limit 300.
      // Client-side filters/sorts in this component still apply on top.
      const { data, error } = await (supabase as unknown as {
        from: (v: string) => {
          select: (s: string) => {
            order: (col: string, opts: { ascending: boolean; nullsFirst?: boolean }) => {
              limit: (n: number) => Promise<{ data: ArchiveRow[] | null; error: unknown }>;
            };
          };
        };
      })
        .from(view)
        .select(
          "result_id,position_id,event_type,delivered_qty,shared_qty,cut_qty,actual_eta," +
            "actual_cost_indicative_usd,actual_cost_invoice_usd,actual_cost_landed_usd," +
            "is_split_shipment,occurred_at,requested_qty,promise_eta_snapshot," +
            "caliber,packaging,pallet_qty,cost_indicative_usd_snapshot," +
            "cost_invoice_usd_snapshot,event_qty,product_name,origin_country_name," +
            "variety_name,responsible_manager_name,shipment_code",
        )
        .order("occurred_at", { ascending: false, nullsFirst: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as ArchiveRow[];
    },
  });

  // Build UI rows: split delivered+cut_qty>0 into two — keep original delivered
  // in tab "Доставлено", emit derived "Урізано" row into tab "Не виконано".
  const uiRows: UiRow[] = useMemo(() => {
    const out: UiRow[] = [];
    for (const r of rawRows) {
      const et = r.event_type;
      if (!et) continue;
      if (et === "delivered") {
        out.push({
          ...r,
          ui_event: "delivered",
          ui_qty: r.delivered_qty ?? r.event_qty ?? null,
          ui_eta: etaForSort(r),
        });
        if (r.cut_qty != null && Number(r.cut_qty) > 0) {
          out.push({
            ...r,
            result_id: r.result_id ? `${r.result_id}::cut` : null,
            ui_event: "cut",
            ui_qty: r.cut_qty,
            ui_eta: r.actual_eta ?? etaForSort(r),
          });
        }
      } else {
        out.push({
          ...r,
          ui_event: et,
          ui_qty: r.event_qty ?? null,
          ui_eta:
            et === "refused"
              ? r.promise_eta_snapshot ?? r.actual_eta ?? r.occurred_at ?? null
              : etaForSort(r),
        });
      }
    }
    // Default ordering depends on tab:
    //  - Доставлено: ETA today first, then tomorrow, then later ASC; within
    //    the same ETA date, product name alphabetically. Past ETA after future.
    //  - Не виконано: newest archive entry first (occurred_at DESC).
    // We compute both keys here and let the visible-tab branch pick the right
    // comparator at render time. For shared list ordering keep delivered logic.
    const todayIso = new Date().toISOString().slice(0, 10);
    out.sort((a, b) => {
      // Не виконано / refused / cut / cancelled: occurred_at DESC.
      if (a.ui_event !== "delivered" || b.ui_event !== "delivered") {
        const ao = a.occurred_at ?? a.ui_eta ?? "";
        const bo = b.occurred_at ?? b.ui_eta ?? "";
        return bo.localeCompare(ao);
      }
      // Delivered: today first → future ASC → past at end. Same-date by product.
      const ae = a.ui_eta ?? "9999-12-31";
      const be = b.ui_eta ?? "9999-12-31";
      const aPast = ae < todayIso;
      const bPast = be < todayIso;
      if (aPast !== bPast) return aPast ? 1 : -1;
      if (ae !== be) return ae.localeCompare(be);
      return (a.product_name ?? "").localeCompare(b.product_name ?? "", "uk");
    });
    return out;
  }, [rawRows]);

  const productOptions = useMemo(
    () => Array.from(new Set(uiRows.map((r) => r.product_name).filter(Boolean))).sort() as string[],
    [uiRows],
  );
  const countryOptions = useMemo(
    () =>
      Array.from(
        new Set(uiRows.map((r) => r.origin_country_name).filter(Boolean)),
      ).sort() as string[],
    [uiRows],
  );

  const doneRows = useMemo(
    () =>
      uiRows.filter(
        (r) =>
          r.ui_event === "delivered" &&
          (!productFilter || r.product_name === productFilter) &&
          (!countryFilter || r.origin_country_name === countryFilter),
      ),
    [uiRows, productFilter, countryFilter],
  );

  const notDoneRows = useMemo(
    () =>
      uiRows.filter(
        (r) =>
          (r.ui_event === "not_fulfilled" ||
            r.ui_event === "refused" ||
            r.ui_event === "cancelled" ||
            r.ui_event === "cut") &&
          (!productFilter || r.product_name === productFilter) &&
          (!countryFilter || r.origin_country_name === countryFilter) &&
          (eventFilter === "all" || r.ui_event === eventFilter),
      ),
    [uiRows, productFilter, countryFilter, eventFilter],
  );

  // Event filter options: only those that actually have rows (before event filter applied)
  const availableEventTypes = useMemo(() => {
    const s = new Set<UiEventType>();
    for (const r of uiRows) {
      if (
        r.ui_event === "not_fulfilled" ||
        r.ui_event === "refused" ||
        r.ui_event === "cancelled" ||
        r.ui_event === "cut"
      )
        s.add(r.ui_event);
    }
    return s;
  }, [uiRows]);

  if (view === "none") {
    return (
      <div className="space-y-4">
        <PageHeader title="Архів поставок" />
        <SectionCard title="Доступ">
          <EmptyState title="Архів недоступний для вашої ролі" />
        </SectionCard>
      </div>
    );
  }

  const visibleRows = tab === "done" ? doneRows : notDoneRows;

  return (
    <div className="space-y-4">
      <PageHeader title="Архів поставок" />

      {/* Tab switcher: green when Доставлено, red when Не виконано */}
      <div className="flex gap-2">
        <button
          onClick={() => {
            setTab("done");
            setEventFilter("all");
          }}
          className={cn(
            "flex-1 rounded-full border-2 px-4 py-2 text-sm font-semibold transition",
            tab === "done"
              ? "border-success bg-success/10 text-success"
              : "border-border bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          Доставлено ({doneRows.length})
        </button>
        <button
          onClick={() => setTab("notdone")}
          className={cn(
            "flex-1 rounded-full border-2 px-4 py-2 text-sm font-semibold transition",
            tab === "notdone"
              ? "border-destructive bg-destructive/10 text-destructive"
              : "border-border bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          Не виконано ({notDoneRows.length})
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select
          value={productFilter}
          onChange={(e) => setProductFilter(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm"
        >
          <option value="">Усі товари</option>
          {productOptions.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          value={countryFilter}
          onChange={(e) => setCountryFilter(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm"
        >
          <option value="">Усі країни</option>
          {countryOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {tab === "notdone" && (
          <select
            value={eventFilter}
            onChange={(e) => setEventFilter(e.target.value as EventFilter)}
            className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm"
          >
            <option value="all">Усі події</option>
            {(["refused", "cancelled", "not_fulfilled", "cut"] as UiEventType[])
              .filter((t) => availableEventTypes.has(t))
              .map((t) => (
                <option key={t} value={t}>
                  {EVENT_LABEL[t]}
                </option>
              ))}
          </select>
        )}
      </div>

      {error ? (
        <SectionCard title="Помилка">
          <div className="space-y-2 text-sm">
            <p className="text-destructive">Не вдалось завантажити архів.</p>
            <button
              onClick={() => refetch()}
              className="rounded-md border border-border px-3 py-1 text-xs"
              disabled={isFetching}
            >
              Спробувати ще раз
            </button>
          </div>
        </SectionCard>
      ) : isLoading ? (
        <SectionCard title="Завантаження">
          <div className="py-6 text-center text-sm text-muted-foreground">Завантаження…</div>
        </SectionCard>
      ) : !visibleRows.length ? (
        <SectionCard title={tab === "done" ? "Доставлено" : "Не виконано"}>
          <EmptyState title="Архівних подій ще немає" />
        </SectionCard>
      ) : (
        <SectionCard title={tab === "done" ? "Доставлено" : "Не виконано"}>
          <ul className="divide-y divide-border">
            {visibleRows.map((r) => {
              const key = r.result_id ?? `${r.position_id}-${r.ui_event}`;
              const isOpen = expanded === key;
              return (
                <li key={key} className="py-2">
                  <button
                    onClick={() => setExpanded(isOpen ? null : key)}
                    className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-1 text-left text-sm"
                  >
                    <span className="font-mono text-info">{fmtDate(r.ui_eta)}</span>
                    <span className="font-medium">
                      {r.product_name ?? "—"}
                      {r.origin_country_name ? ` (${r.origin_country_name})` : ""}
                    </span>
                    {tab === "done" ? (
                      <>
                        {r.caliber && (
                          <span className="text-xs text-muted-foreground">· {r.caliber}</span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          · {fmtCost(actualCost(r) ?? costAtOrder(r))}
                        </span>
                        <span className="ml-auto text-xs font-semibold">
                          {fmtNum(r.ui_qty)} пал.
                          {r.is_split_shipment ? (
                            <span className="ml-1 text-warning" aria-label="split">
                              *
                            </span>
                          ) : null}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="ml-auto text-xs font-semibold">
                          {fmtNum(r.ui_qty)} пал.
                        </span>
                        <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-destructive">
                          {EVENT_LABEL[r.ui_event]}
                        </span>
                      </>
                    )}
                  </button>

                  {isOpen && (
                    <div className="mt-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
                      {tab === "done" ? (
                        <DeliveredDetail row={r} />
                      ) : (
                        <NotDoneDetail row={r} />
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}

function DeliveredDetail({ row: r }: { row: UiRow }) {
  // Two parallel grid lines: Було / Стало — same column starts
  const cols = "grid grid-cols-[5rem_minmax(0,1fr)_5rem_4rem] gap-2 items-baseline";
  return (
    <div className="space-y-2">
      <div className={cols}>
        <span className="text-[10px] font-semibold uppercase text-muted-foreground">Було</span>
        <span className="font-mono text-info">{fmtDate(r.promise_eta_snapshot)}</span>
        <span className="truncate">
          {r.product_name ?? "—"}
          {r.origin_country_name ? ` (${r.origin_country_name})` : ""}
        </span>
        <span className="text-right">{fmtCost(costAtOrder(r))}</span>
        <span className="text-right font-semibold">{fmtNum(r.requested_qty)} пал.</span>
      </div>
      <div className={cols}>
        <span className="text-[10px] font-semibold uppercase text-muted-foreground">Стало</span>
        <span className="font-mono text-info">{fmtDate(r.actual_eta)}</span>
        <span className="truncate">
          {r.product_name ?? "—"}
          {r.origin_country_name ? ` (${r.origin_country_name})` : ""}
        </span>
        <span className="text-right">{fmtCost(actualCost(r))}</span>
        <span className="text-right font-semibold">{fmtNum(r.delivered_qty)} пал.</span>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-2 text-muted-foreground">
        {r.pallet_qty != null && <span>Палет: {fmtNum(r.pallet_qty)}</span>}
        {r.variety_name && <span>Сорт: {r.variety_name}</span>}
        {r.caliber && <span>Калібр: {r.caliber}</span>}
        {r.packaging && <span>Упаковка: {r.packaging}</span>}
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-2">
        {r.shipment_code && (
          <span className="font-mono font-semibold">{r.shipment_code}</span>
        )}
        {r.responsible_manager_name && (
          <span className="text-muted-foreground">· {r.responsible_manager_name}</span>
        )}
      </div>

      {r.is_split_shipment && (
        <div className="border-t border-border pt-2 text-[11px] text-warning">
          * Частина товару в іншій поставці — деталі будуть додані пізніше
        </div>
      )}
    </div>
  );
}

function NotDoneDetail({ row: r }: { row: UiRow }) {
  // Event date rules per spec
  const eventDate =
    r.ui_event === "refused" || r.ui_event === "cancelled"
      ? r.occurred_at
      : r.ui_event === "not_fulfilled"
        ? r.promise_eta_snapshot ?? r.actual_eta
        : r.actual_eta; // cut
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[5rem_minmax(0,1fr)_4rem] items-baseline gap-2">
        <span className="font-mono text-info">{fmtDate(r.ui_eta)}</span>
        <span className="truncate">
          {r.product_name ?? "—"}
          {r.origin_country_name ? ` (${r.origin_country_name})` : ""}
        </span>
        <span className="text-right font-semibold">{fmtNum(r.requested_qty)} пал.</span>
      </div>
      <div className="grid grid-cols-[5rem_minmax(0,1fr)_minmax(0,1fr)] items-baseline gap-2 border-t border-border pt-2">
        <span className="font-mono text-info">{fmtDate(eventDate)}</span>
        <span className="font-bold text-destructive">{EVENT_LABEL[r.ui_event]}</span>
        <span className="truncate text-muted-foreground">
          {r.responsible_manager_name ?? "—"}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-2 text-muted-foreground">
        {r.variety_name && <span>Сорт: {r.variety_name}</span>}
        {r.caliber && <span>Калібр: {r.caliber}</span>}
        {r.packaging && <span>Упаковка: {r.packaging}</span>}
        {r.shipment_code && (
          <span className="font-mono font-semibold text-foreground">{r.shipment_code}</span>
        )}
      </div>
    </div>
  );
}

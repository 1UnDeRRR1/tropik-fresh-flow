import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { cn } from "@/lib/utils";
import { useAuth, type AppRole } from "@/lib/auth";
import { CostPair } from "@/components/CostPair";
import { toUaCountry, toShortUaCountry } from "@/lib/countries";

// Same compact ETA format used in "Головна" branch list (e.g. "12 черв.").
const fmtEtaShort = (eta: string | null) => {
  if (!eta) return "—";
  const d = new Date(eta);
  if (Number.isNaN(d.getTime())) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  const mo = d.toLocaleDateString("uk-UA", { month: "short" }).replace(/\.$/, "");
  return `${day}\u202F${mo}.`;
};

// Same manager abbreviation as branch list: "Назар Лукач" → "Назар Л.".
const shortenManager = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0]} ${parts[1].charAt(0)}.`;
};

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
          {/* Visual parity with "Головна" branch list (BranchFlatList). */}
          <ul className="divide-y divide-border">
            {visibleRows.map((r) => {
              const key = r.result_id ?? `${r.position_id}-${r.ui_event}`;
              const isOpen = expanded === key;

              const SEP_TIGHT = "\u2009·\u2009";
              const product = r.product_name ?? "—";
              const countryFull = r.origin_country_name
                ? toUaCountry(r.origin_country_name)
                : "";
              const countryShortRaw = r.origin_country_name
                ? toShortUaCountry(r.origin_country_name)
                : "";
              const variety = r.variety_name ?? "";
              const fullLeftLen = product.length + countryFull.length + variety.length;
              const useShortCountry =
                fullLeftLen > 28 && !!countryShortRaw && countryShortRaw !== countryFull;
              const country = useShortCountry ? `${countryShortRaw}.` : countryFull;
              const tailParts: string[] = [];
              if (country) tailParts.push(country);
              if (variety) tailParts.push(variety);
              const tail = tailParts.length ? ` · ${tailParts.join(" · ")}` : "";

              const rawMgr = r.responsible_manager_name ?? "";
              const code = r.shipment_code ?? "";
              const metaApproxLen =
                4 + fmtEtaShort(r.ui_eta).length +
                (code ? 3 + code.length : 0) +
                (rawMgr ? 3 + rawMgr.length : 0);
              const mgr = rawMgr && metaApproxLen > 34 ? shortenManager(rawMgr) : rawMgr;

              // Cost shown on bottom-right: prefer actual (delivered), fall back to snapshot.
              const costInd =
                r.actual_cost_indicative_usd ?? r.cost_indicative_usd_snapshot ?? null;
              const costInv =
                r.actual_cost_invoice_usd ?? r.cost_invoice_usd_snapshot ?? null;

              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : key)}
                    className="w-full py-2 text-left text-sm active:opacity-70"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-sm text-foreground">
                        <span className="font-bold">{product}</span>
                        {tail ? <span>{tail}</span> : null}
                      </div>
                      <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">
                        {fmtNum(r.ui_qty)}п
                        {tab === "done" && r.is_split_shipment ? (
                          <span className="ml-0.5 text-warning" aria-label="split">*</span>
                        ) : null}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-baseline justify-between gap-2 text-[11px] font-normal text-muted-foreground">
                      <div className="min-w-0 flex-1 overflow-hidden whitespace-nowrap">
                        <span className="font-mono font-semibold text-sky-600 dark:text-sky-300">
                          {"ETA\u202F"}{fmtEtaShort(r.ui_eta)}
                        </span>
                        {code ? (
                          <span className="text-foreground/80">
                            {SEP_TIGHT}<span className="font-mono">{code}</span>
                          </span>
                        ) : null}
                        {mgr ? (
                          <span className="text-foreground/80"> · {mgr}</span>
                        ) : null}
                      </div>
                      <span className="shrink-0">
                        {tab === "done" ? (
                          <CostPair indicative={costInd} invoice={costInv} size="xs" />
                        ) : (
                          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-destructive">
                            {EVENT_LABEL[r.ui_event]}
                          </span>
                        )}
                      </span>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="mb-2 mt-1 rounded-lg border border-border bg-muted/30 p-3 text-xs">
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

// UA pluralization for "день": 1 → день, 2-4 → дні, 5+ → днів,
// with the 11–14 exception always taking "днів".
function pluralizeDays(n: number): string {
  const abs = Math.abs(n);
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 14) return "днів";
  const mod10 = abs % 10;
  if (mod10 === 1) return "день";
  if (mod10 >= 2 && mod10 <= 4) return "дні";
  return "днів";
}

function diffDays(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return null;
  const ms = da.setHours(0, 0, 0, 0) - db.setHours(0, 0, 0, 0);
  return Math.round(ms / 86_400_000);
}

function DeliveredDetail({ row: r }: { row: UiRow }) {
  // 3-column mini-table: Було (L) | Опис (C) | Стало (R)
  const rowCls = "grid grid-cols-[1fr_auto_1fr] items-baseline gap-2 py-1";
  const leftCls = "text-left tabular-nums";
  const midLabelCls =
    "text-[10px] font-semibold uppercase tracking-wide text-muted-foreground text-center px-2 py-1 rounded";
  const rightCls = "text-right tabular-nums";

  // ETA
  const etaDelta = diffDays(r.actual_eta, r.promise_eta_snapshot);
  let etaMidBg = "";
  let etaNote: string | null = null;
  if (etaDelta != null && etaDelta !== 0) {
    if (etaDelta > 0) {
      etaMidBg = "bg-destructive/10";
      etaNote = `+${etaDelta} ${pluralizeDays(etaDelta)}`;
    } else {
      etaMidBg = "bg-success/10";
      etaNote = `${etaDelta} ${pluralizeDays(etaDelta)}`;
    }
  }

  // Pallets
  const isSplit = !!r.is_split_shipment;
  const reqQ = r.requested_qty == null ? null : Number(r.requested_qty);
  const delQ = r.delivered_qty == null ? null : Number(r.delivered_qty);
  const palDelta =
    !isSplit && reqQ != null && delQ != null ? delQ - reqQ : null;
  let palMidBg = "";
  let palNote: string | null = null;
  if (palDelta != null && palDelta !== 0) {
    palMidBg = "bg-destructive/10";
    palNote =
      palDelta > 0 ? `+${palDelta}п надлишку` : `${palDelta}п недодали`;
  }

  // Cost
  const sInd = r.cost_indicative_usd_snapshot;
  const sInv = r.cost_invoice_usd_snapshot;
  const aInd = r.actual_cost_indicative_usd;
  const aInv = r.actual_cost_invoice_usd;
  const dInd = sInd != null && aInd != null ? Number(aInd) - Number(sInd) : null;
  const dInv = sInv != null && aInv != null ? Number(aInv) - Number(sInv) : null;
  let costMidBg = "";
  let costNote: string | null = null;
  const fmtSigned = (v: number) =>
    `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
  const parts: string[] = [];
  if (dInd != null) parts.push(`$${fmtSigned(dInd)}`);
  else if (sInd != null || aInd != null) parts.push("—");
  if (dInv != null) parts.push(`$${fmtSigned(dInv)}`);
  else if (sInv != null || aInv != null) parts.push("—");
  const haveBoth = dInd != null && dInv != null;
  if (haveBoth) {
    if (dInd! > 0 && dInv! > 0) {
      costMidBg = "bg-destructive/10";
      costNote = `здорожчало ${parts.join(" / ")}`;
    } else if (dInd! < 0 && dInv! < 0) {
      costMidBg = "bg-success/10";
      costNote = `подешевшало ${parts.join(" / ")}`;
    } else if (dInd !== 0 || dInv !== 0) {
      costMidBg = "bg-warning/10";
      costNote = parts.join(" / ");
    }
  } else if ((dInd != null && dInd !== 0) || (dInv != null && dInv !== 0)) {
    // partial info — show plain note without misleading verb
    costMidBg = "bg-warning/10";
    costNote = parts.join(" / ");
  }

  // Variety / Caliber — single source today; highlight only if differs
  const varietyDiff = false; // single source: snapshot == actual
  const caliberDiff = false; // single source: snapshot == actual

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="text-center space-y-0.5">
        <div className="text-sm">
          <span className="font-bold">{r.product_name ?? "—"}</span>
          {r.origin_country_name ? (
            <span className="font-normal"> {r.origin_country_name}</span>
          ) : null}
        </div>
        {(r.shipment_code || r.responsible_manager_name) && (
          <div className="text-[11px] text-muted-foreground">
            {r.shipment_code ? (
              <span className="font-mono">{r.shipment_code}</span>
            ) : null}
            {r.shipment_code && r.responsible_manager_name ? " · " : ""}
            {r.responsible_manager_name ?? ""}
          </div>
        )}
      </div>

      {/* Mini-table */}
      <div className="rounded-lg border border-border bg-card/40 px-2 py-1 text-[12px]">
        {/* Header row */}
        <div className={rowCls}>
          <span className={cn(leftCls, "text-[10px] uppercase text-muted-foreground")}>Було</span>
          <span className="text-[10px] uppercase text-muted-foreground text-center">Опис</span>
          <span className={cn(rightCls, "text-[10px] uppercase text-muted-foreground")}>Стало</span>
        </div>

        {/* ETA */}
        <div className={rowCls}>
          <span className={cn(leftCls, "font-mono text-info")}>
            {fmtDate(r.promise_eta_snapshot)}
          </span>
          <span className={cn(midLabelCls, etaMidBg)}>
            <span className="block">дата прибуття</span>
            {etaNote && (
              <span
                className={cn(
                  "block text-[10px] font-bold mt-0.5",
                  etaDelta! > 0 ? "text-destructive" : "text-success",
                )}
              >
                {etaNote}
              </span>
            )}
          </span>
          <span className={cn(rightCls, "font-mono text-info")}>
            {fmtDate(r.actual_eta)}
          </span>
        </div>

        {/* Pallets */}
        <div className={rowCls}>
          <span className={cn(leftCls, "font-semibold")}>
            {fmtNum(r.requested_qty)} пал.
          </span>
          <span className={cn(midLabelCls, palMidBg)}>
            <span className="block">кількість палет</span>
            {palNote && (
              <span className="block text-[10px] font-bold text-destructive mt-0.5">
                {palNote}
              </span>
            )}
          </span>
          <span className={cn(rightCls, "font-semibold")}>
            {fmtNum(r.delivered_qty)} пал.
            {isSplit ? (
              <span className="ml-0.5 text-warning" aria-label="split">*</span>
            ) : null}
          </span>
        </div>

        {/* Cost */}
        <div className={rowCls}>
          <span className={leftCls}>
            <CostPair indicative={sInd} invoice={sInv} />
          </span>
          <span className={cn(midLabelCls, costMidBg)}>
            <span className="block">собівартість</span>
            {costNote && (
              <span
                className={cn(
                  "block text-[10px] font-bold mt-0.5",
                  costMidBg === "bg-destructive/10"
                    ? "text-destructive"
                    : costMidBg === "bg-success/10"
                      ? "text-success"
                      : "text-warning",
                )}
              >
                {costNote}
              </span>
            )}
          </span>
          <span className={rightCls}>
            <CostPair indicative={aInd} invoice={aInv} />
          </span>
        </div>

        {/* Variety */}
        <div className={rowCls}>
          <span className={leftCls}>{r.variety_name ?? "—"}</span>
          <span className={cn(midLabelCls, varietyDiff && "bg-destructive/10")}>
            сорт
          </span>
          <span className={rightCls}>{r.variety_name ?? "—"}</span>
        </div>

        {/* Caliber */}
        <div className={rowCls}>
          <span className={leftCls}>{r.caliber ?? "—"}</span>
          <span className={cn(midLabelCls, caliberDiff && "bg-destructive/10")}>
            калібр
          </span>
          <span className={rightCls}>{r.caliber ?? "—"}</span>
        </div>
      </div>

      {isSplit && (
        <div className="text-[11px] text-muted-foreground">
          * частина в іншій поставці — деталі будуть додані пізніше
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

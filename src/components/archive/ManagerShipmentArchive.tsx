import { useMemo, useState, useEffect } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ChevronRight, ChevronLeft, Package, MapPin, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { CostPair } from "@/components/CostPair";
import { toUaCountry } from "@/lib/countries";

// Public surface: receives already-filtered (tab/product/country/event) UiRows
// from archive.tsx and renders a shipment-first drill-down. No DB queries here.

type UiEventType = "delivered" | "not_fulfilled" | "refused" | "cancelled" | "cut";

export interface ManagerArchiveRow {
  result_id: string | null;
  position_id: string | null;
  shipment_id: string | null;
  shipment_code: string | null;
  branch_id: string | null;
  branch_name: string | null;
  responsible_manager_name: string | null;
  product_name: string | null;
  origin_country_name: string | null;
  variety_name: string | null;
  caliber: string | null;
  packaging: string | null;
  pallet_qty: number | null;
  event_type: "delivered" | "not_fulfilled" | "refused" | "cancelled" | null;
  ui_event: UiEventType;
  ui_qty: number | null;
  ui_eta: string | null;
  event_qty: number | null;
  delivered_qty: number | null;
  cut_qty: number | null;
  shared_qty: number | null;
  requested_qty: number | null;
  actual_eta: string | null;
  promise_eta_snapshot: string | null;
  cost_indicative_usd_snapshot: number | null;
  cost_invoice_usd_snapshot: number | null;
  actual_cost_indicative_usd: number | null;
  actual_cost_invoice_usd: number | null;
  actual_cost_landed_usd: number | null;
  is_split_shipment: boolean | null;
  occurred_at: string | null;
  notes?: string | null;
}

const EVENT_LABEL: Record<UiEventType, string> = {
  delivered: "Доставлено",
  not_fulfilled: "Не виконано",
  refused: "Відмова",
  cancelled: "Скасовано",
  cut: "Урізано",
};

const fmtEtaShort = (eta: string | null) => {
  if (!eta) return "—";
  const d = new Date(eta);
  if (Number.isNaN(d.getTime())) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  const mo = d.toLocaleDateString("uk-UA", { month: "short" }).replace(/\.$/, "");
  return `${day}\u202F${mo}.`;
};

const fmtNum = (n: number | null | undefined, digits = 0) =>
  n == null || Number.isNaN(Number(n))
    ? "—"
    : Number(n).toLocaleString("uk-UA", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });

const NO_SHIPMENT_KEY = "__no_shipment__";
const NO_SHIPMENT_LABEL = "Без поставки · Скасовані/Відмовлені до поставки";

function aggregateEvent(events: Iterable<UiEventType>): UiEventType | "mixed" {
  let first: UiEventType | null = null;
  for (const e of events) {
    if (first == null) first = e;
    else if (first !== e) return "mixed";
  }
  return first ?? "delivered";
}

const STATUS_BADGE: Record<UiEventType | "mixed", string> = {
  delivered: "bg-success/10 text-success",
  not_fulfilled: "bg-destructive/10 text-destructive",
  refused: "bg-destructive/10 text-destructive",
  cancelled: "bg-destructive/10 text-destructive",
  cut: "bg-warning/10 text-warning",
  mixed: "bg-muted text-foreground",
};

const STATUS_LABEL: Record<UiEventType | "mixed", string> = {
  ...EVENT_LABEL,
  mixed: "Змішано",
};

interface ShipmentGroup {
  key: string;
  shipment_id: string | null;
  shipment_code: string | null;
  label: string;
  newestOccurredAt: string | null;
  totalQty: number;
  positionCount: number;
  branchCount: number;
  managerName: string | null;
  status: UiEventType | "mixed";
  rows: ManagerArchiveRow[];
}

interface PositionGroup {
  key: string;
  position_id: string | null;
  product_name: string | null;
  origin_country_name: string | null;
  variety_name: string | null;
  caliber: string | null;
  totalQty: number;
  branchCount: number;
  status: UiEventType | "mixed";
  costInd: number | null;
  costInv: number | null;
  ui_eta: string | null;
  rows: ManagerArchiveRow[];
}

interface BranchGroup {
  key: string;
  branch_id: string | null;
  branch_name: string | null;
  requested: number;
  approved: number; // event_qty for non-refused
  delivered: number;
  cut: number;
  refused: number;
  cancelled: number;
  notFulfilled: number;
  status: UiEventType | "mixed";
  promise_eta: string | null;
  actual_eta: string | null;
  rows: ManagerArchiveRow[];
}

function buildShipmentGroups(rows: ManagerArchiveRow[]): ShipmentGroup[] {
  const buckets = new Map<string, ManagerArchiveRow[]>();
  for (const r of rows) {
    const key = r.shipment_id ?? NO_SHIPMENT_KEY;
    const arr = buckets.get(key);
    if (arr) arr.push(r);
    else buckets.set(key, [r]);
  }
  const out: ShipmentGroup[] = [];
  for (const [key, list] of buckets) {
    const positions = new Set<string>();
    const branches = new Set<string>();
    let totalQty = 0;
    let newestOccurredAt: string | null = null;
    let shipmentCode: string | null = null;
    let managerName: string | null = null;
    for (const r of list) {
      const posKey = r.position_id ?? `${r.product_name}|${r.origin_country_name}|${r.variety_name}|${r.caliber}`;
      positions.add(posKey);
      if (r.branch_id) branches.add(r.branch_id);
      else if (r.branch_name) branches.add(`name:${r.branch_name}`);
      const q = Number(r.ui_qty ?? 0);
      if (!Number.isNaN(q)) totalQty += q;
      if (r.occurred_at && (!newestOccurredAt || r.occurred_at > newestOccurredAt))
        newestOccurredAt = r.occurred_at;
      if (!shipmentCode && r.shipment_code) shipmentCode = r.shipment_code;
      if (!managerName && r.responsible_manager_name) managerName = r.responsible_manager_name;
    }
    const status = aggregateEvent(list.map((r) => r.ui_event));
    const label =
      key === NO_SHIPMENT_KEY
        ? NO_SHIPMENT_LABEL
        : shipmentCode ?? `Поставка ${key.slice(0, 8)}`;
    out.push({
      key,
      shipment_id: key === NO_SHIPMENT_KEY ? null : key,
      shipment_code: shipmentCode,
      label,
      newestOccurredAt,
      totalQty,
      positionCount: positions.size,
      branchCount: branches.size,
      managerName,
      status,
      rows: list,
    });
  }
  out.sort((a, b) => {
    const ao = a.newestOccurredAt ?? "";
    const bo = b.newestOccurredAt ?? "";
    if (ao !== bo) return bo.localeCompare(ao);
    return (b.shipment_code ?? "").localeCompare(a.shipment_code ?? "");
  });
  return out;
}

function buildPositionGroups(rows: ManagerArchiveRow[]): PositionGroup[] {
  const buckets = new Map<string, ManagerArchiveRow[]>();
  for (const r of rows) {
    const key =
      r.position_id ??
      `${r.product_name}|${r.origin_country_name}|${r.variety_name}|${r.caliber}`;
    const arr = buckets.get(key);
    if (arr) arr.push(r);
    else buckets.set(key, [r]);
  }
  const out: PositionGroup[] = [];
  for (const [key, list] of buckets) {
    const first = list[0];
    const branches = new Set<string>();
    let totalQty = 0;
    let newestEta: string | null = null;
    let costInd: number | null = null;
    let costInv: number | null = null;
    for (const r of list) {
      if (r.branch_id) branches.add(r.branch_id);
      else if (r.branch_name) branches.add(`name:${r.branch_name}`);
      const q = Number(r.ui_qty ?? 0);
      if (!Number.isNaN(q)) totalQty += q;
      const eta = r.actual_eta ?? r.occurred_at ?? null;
      if (eta && (!newestEta || eta > newestEta)) newestEta = eta;
      if (costInd == null)
        costInd = r.actual_cost_indicative_usd ?? r.cost_indicative_usd_snapshot ?? null;
      if (costInv == null)
        costInv = r.actual_cost_invoice_usd ?? r.cost_invoice_usd_snapshot ?? null;
    }
    out.push({
      key,
      position_id: first.position_id,
      product_name: first.product_name,
      origin_country_name: first.origin_country_name,
      variety_name: first.variety_name,
      caliber: first.caliber,
      totalQty,
      branchCount: branches.size,
      status: aggregateEvent(list.map((r) => r.ui_event)),
      costInd,
      costInv,
      ui_eta: newestEta,
      rows: list,
    });
  }
  out.sort((a, b) => {
    const ae = a.ui_eta ?? "";
    const be = b.ui_eta ?? "";
    if (ae !== be) {
      if (!ae) return 1;
      if (!be) return -1;
      return be.localeCompare(ae);
    }
    return (a.product_name ?? "").localeCompare(b.product_name ?? "", "uk");
  });
  return out;
}

function buildBranchGroups(rows: ManagerArchiveRow[]): BranchGroup[] {
  const buckets = new Map<string, ManagerArchiveRow[]>();
  for (const r of rows) {
    const key = r.branch_id ?? `name:${r.branch_name ?? "—"}`;
    const arr = buckets.get(key);
    if (arr) arr.push(r);
    else buckets.set(key, [r]);
  }
  const out: BranchGroup[] = [];
  for (const [key, list] of buckets) {
    const first = list[0];
    let requested = 0,
      approved = 0,
      delivered = 0,
      cut = 0,
      refused = 0,
      cancelled = 0,
      notFulfilled = 0;
    let promise_eta: string | null = null;
    let actual_eta: string | null = null;
    for (const r of list) {
      const q = Number(r.ui_qty ?? 0) || 0;
      const reqQ = Number(r.requested_qty ?? 0) || 0;
      requested = Math.max(requested, reqQ);
      switch (r.ui_event) {
        case "delivered":
          delivered += Number(r.delivered_qty ?? r.event_qty ?? 0) || 0;
          approved += Number(r.event_qty ?? 0) || 0;
          break;
        case "cut":
          cut += q;
          break;
        case "refused":
          refused += q;
          break;
        case "cancelled":
          cancelled += q;
          break;
        case "not_fulfilled":
          notFulfilled += q;
          break;
      }
      if (r.promise_eta_snapshot && !promise_eta) promise_eta = r.promise_eta_snapshot;
      if (r.actual_eta && (!actual_eta || r.actual_eta > actual_eta)) actual_eta = r.actual_eta;
    }
    out.push({
      key,
      branch_id: first.branch_id,
      branch_name: first.branch_name,
      requested,
      approved,
      delivered,
      cut,
      refused,
      cancelled,
      notFulfilled,
      status: aggregateEvent(list.map((r) => r.ui_event)),
      promise_eta,
      actual_eta,
      rows: list,
    });
  }
  const order: Record<UiEventType | "mixed", number> = {
    delivered: 0,
    not_fulfilled: 1,
    cut: 2,
    cancelled: 3,
    refused: 4,
    mixed: 5,
  };
  out.sort((a, b) => {
    const oa = order[a.status];
    const ob = order[b.status];
    if (oa !== ob) return oa - ob;
    return (a.branch_name ?? "").localeCompare(b.branch_name ?? "", "uk");
  });
  return out;
}

function StatusChip({ status }: { status: UiEventType | "mixed" }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        STATUS_BADGE[status],
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

interface Props {
  rows: ManagerArchiveRow[];
  emptyLabel: string;
  // Render functions reuse the existing detail panels from archive.tsx
  renderDeliveredDetail: (row: ManagerArchiveRow) => React.ReactNode;
  renderNotDoneDetail: (row: ManagerArchiveRow) => React.ReactNode;
}

export function ManagerShipmentArchive({
  rows,
  emptyLabel,
  renderDeliveredDetail,
  renderNotDoneDetail,
}: Props) {
  // Drill-down state
  const [openShipKey, setOpenShipKey] = useState<string | null>(null);
  const [openPosKey, setOpenPosKey] = useState<string | null>(null);
  const [openBranchKey, setOpenBranchKey] = useState<string | null>(null);

  const shipmentGroups = useMemo(() => buildShipmentGroups(rows), [rows]);

  const activeShipment = useMemo(
    () => shipmentGroups.find((g) => g.key === openShipKey) ?? null,
    [shipmentGroups, openShipKey],
  );
  const positionGroups = useMemo(
    () => (activeShipment ? buildPositionGroups(activeShipment.rows) : []),
    [activeShipment],
  );
  const activePosition = useMemo(
    () => positionGroups.find((g) => g.key === openPosKey) ?? null,
    [positionGroups, openPosKey],
  );
  const branchGroups = useMemo(
    () => (activePosition ? buildBranchGroups(activePosition.rows) : []),
    [activePosition],
  );
  const activeBranch = useMemo(
    () => branchGroups.find((g) => g.key === openBranchKey) ?? null,
    [branchGroups, openBranchKey],
  );

  // If selection becomes stale (e.g. tab changes), reset
  useEffect(() => {
    if (openShipKey && !shipmentGroups.some((g) => g.key === openShipKey)) {
      setOpenShipKey(null);
      setOpenPosKey(null);
      setOpenBranchKey(null);
    }
  }, [shipmentGroups, openShipKey]);

  const closeAll = () => {
    setOpenShipKey(null);
    setOpenPosKey(null);
    setOpenBranchKey(null);
  };

  if (!rows.length) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  const level: 1 | 2 | 3 | 4 = activeBranch ? 4 : activePosition ? 3 : activeShipment ? 2 : 1;

  return (
    <>
      {/* Level 1 — Shipment group list */}
      <ul className="divide-y divide-border">
        {shipmentGroups.map((g) => (
          <li key={g.key}>
            <button
              type="button"
              onClick={() => setOpenShipKey(g.key)}
              className="flex w-full items-start gap-2 py-1.5 text-left active:opacity-70"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={cn(
                      "min-w-0 truncate text-[13px] font-semibold text-foreground",
                      g.shipment_id ? "font-mono" : "",
                    )}
                  >
                    {g.label}
                  </span>
                  <span className="shrink-0 text-[13px] font-semibold tabular-nums text-foreground">
                    {fmtNum(g.totalQty)}п
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span className="font-mono text-info">
                    {fmtEtaShort(g.newestOccurredAt)}
                  </span>
                  <span>·</span>
                  <span>{g.positionCount} поз.</span>
                  <span>·</span>
                  <span>{g.branchCount} філій</span>
                  {g.managerName ? (
                    <>
                      <span>·</span>
                      <span className="truncate">{g.managerName}</span>
                    </>
                  ) : null}
                  <span className="ml-auto">
                    <StatusChip status={g.status} />
                  </span>
                </div>
              </div>
              <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>


      {/* Drill-down sheet */}
      <Sheet open={!!activeShipment} onOpenChange={(o) => !o && closeAll()}>
        <SheetContent
          side="right"
          className="flex h-[100dvh] w-full max-w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        >
          {/* Header / breadcrumbs */}
          <div className="flex items-center gap-2 border-b border-border px-3 py-2 pr-12 text-xs">
            <button
              type="button"
              onClick={() => {
                if (activeBranch) setOpenBranchKey(null);
                else if (activePosition) setOpenPosKey(null);
                else if (activeShipment) closeAll();
              }}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted"
              aria-label="Назад"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <nav className="min-w-0 flex-1 truncate" aria-label="breadcrumbs">
              <button
                type="button"
                onClick={closeAll}
                className="text-muted-foreground hover:text-foreground"
              >
                Архів
              </button>
              {activeShipment ? (
                <>
                  <span className="mx-1 text-muted-foreground">›</span>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenPosKey(null);
                      setOpenBranchKey(null);
                    }}
                    className={cn(
                      "font-mono",
                      level === 2
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {activeShipment.label}
                  </button>
                </>
              ) : null}
              {activePosition ? (
                <>
                  <span className="mx-1 text-muted-foreground">›</span>
                  <button
                    type="button"
                    onClick={() => setOpenBranchKey(null)}
                    className={cn(
                      level === 3
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {activePosition.product_name ?? "—"}
                  </button>
                </>
              ) : null}
              {activeBranch ? (
                <>
                  <span className="mx-1 text-muted-foreground">›</span>
                  <span className="text-foreground">{activeBranch.branch_name ?? "—"}</span>
                </>
              ) : null}
            </nav>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-2">
            {level === 2 && activeShipment ? (
              <ul className="divide-y divide-border">
                {positionGroups.map((p) => (
                  <li key={p.key}>
                    <button
                      type="button"
                      onClick={() => setOpenPosKey(p.key)}
                      className="flex w-full items-start gap-2 py-1.5 text-left active:opacity-70"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="min-w-0 truncate text-[13px] font-semibold text-foreground">
                            {p.product_name ?? "—"}
                            {p.origin_country_name ? (
                              <span className="font-normal text-muted-foreground">
                                {" · "}
                                {toUaCountry(p.origin_country_name)}
                              </span>
                            ) : null}
                          </span>
                          <span className="shrink-0 text-[13px] font-semibold tabular-nums">
                            {fmtNum(p.totalQty)}п
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
                          {p.variety_name ? <span>{p.variety_name}</span> : null}
                          {p.caliber ? <span>· {p.caliber}</span> : null}
                          <span>· {p.branchCount} філій</span>
                          <span className="font-mono text-info">
                            · {fmtEtaShort(p.ui_eta)}
                          </span>
                          <span className="ml-auto flex items-center gap-2">
                            {p.costInd != null || p.costInv != null ? (
                              <CostPair indicative={p.costInd} invoice={p.costInv} size="xs" />
                            ) : null}
                            <StatusChip status={p.status} />
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {level === 3 && activePosition ? (
              <ul className="divide-y divide-border">
                {branchGroups.map((b) => (
                  <li key={b.key}>
                    <button
                      type="button"
                      onClick={() => setOpenBranchKey(b.key)}
                      className="flex w-full items-start gap-2 py-2.5 text-left active:opacity-70"
                    >
                      <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="min-w-0 truncate text-sm font-bold text-foreground">
                            {b.branch_name ?? "—"}
                          </span>
                          <StatusChip status={b.status} />
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground tabular-nums">
                          <span>Запит: {fmtNum(b.requested)}п</span>
                          {b.approved > 0 ? <span>· Підтв.: {fmtNum(b.approved)}п</span> : null}
                          {b.delivered > 0 ? (
                            <span className="text-success">· Дост.: {fmtNum(b.delivered)}п</span>
                          ) : null}
                          {b.cut > 0 ? (
                            <span className="text-warning">· Уріз.: {fmtNum(b.cut)}п</span>
                          ) : null}
                          {b.notFulfilled > 0 ? (
                            <span className="text-destructive">
                              · Не вик.: {fmtNum(b.notFulfilled)}п
                            </span>
                          ) : null}
                          {b.cancelled > 0 ? (
                            <span className="text-destructive">
                              · Скас.: {fmtNum(b.cancelled)}п
                            </span>
                          ) : null}
                          {b.refused > 0 ? (
                            <span className="text-destructive">
                              · Відм.: {fmtNum(b.refused)}п
                            </span>
                          ) : null}
                          {b.promise_eta || b.actual_eta ? (
                            <span className="ml-auto font-mono text-info">
                              {fmtEtaShort(b.promise_eta)} → {fmtEtaShort(b.actual_eta)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {level === 4 && activeBranch ? (
              <div className="space-y-3">
                {activeBranch.rows.map((r, i) => (
                  <div
                    key={(r.result_id ?? `${r.position_id}-${r.ui_event}`) + i}
                    className="rounded-lg border border-border bg-muted/30 p-3 text-xs"
                  >
                    {r.ui_event === "delivered"
                      ? renderDeliveredDetail(r)
                      : renderNotDoneDetail(r)}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

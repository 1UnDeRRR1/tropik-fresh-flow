import { MobileGlassTable, type MobileGlassRow } from "@/components/tropik/mobile-glass-table";
import { CostPair } from "@/components/CostPair";
import { toUaCountry } from "@/lib/countries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ManagerOffer, ManagerOfferResponse } from "@/lib/manager-offers";
import { getBranchOfferStatus, isRealShipmentCode } from "@/lib/branch-offer-status";
import type { ReactNode } from "react";

// Note: no position_id grouping applied here. Rows come already flat from
// parent (Активні / Підтверджені buckets), so we just render them.

const fmtEtaShort = (eta: string | null | undefined) => {
  if (!eta) return "—";
  const d = new Date(eta);
  if (Number.isNaN(d.getTime())) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  const mo = d.toLocaleDateString("uk-UA", { month: "short" }).replace(/\.$/, "");
  return `${day}\u202F${mo}.`;
};

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("uk-UA") : "—";

/**
 * Malekhiv "Пропозиції ЗЕД" list — one bucket at a time (Активні or
 * Підтверджені). L1/L2 only. Активні: no UAH price displayed. No
 * position_id grouping.
 *
 * Actions in L2:
 *   Активні + still open → pallet input + "Запитати"/"Оновити", + "Скасувати запит".
 *   Підтверджені or closed → read-only summary.
 */
export function MalekhivBranchOffersList({
  bucket,
  rows,
  responseByOffer,
  shipmentById,
  managerNameById,
  drafts,
  onDraftChange,
  onSubmit,
  onCancel,
  submitting,
  cancelling,
}: {
  bucket: "active" | "confirmed";
  rows: ManagerOffer[];
  responseByOffer: Record<string, ManagerOfferResponse>;
  shipmentById: Record<string, { code: string; eta: string | null; arrived_at: string | null }>;
  managerNameById: Record<string, string>;
  drafts: Record<string, string>;
  onDraftChange: (offerId: string, value: string) => void;
  onSubmit: (offerId: string, pallets: number) => void;
  onCancel: (responseId: string) => void;
  submitting: boolean;
  cancelling: boolean;
}) {
  const glassRows: MobileGlassRow[] = rows.map((o) => {
    const r = responseByOffer[o.id];
    const ship = o.linked_shipment_id ? shipmentById[o.linked_shipment_id] : null;
    const etaIso = ship?.arrived_at ?? ship?.eta ?? o.expected_eta ?? null;
    const mgrRaw = managerNameById[o.created_by] ?? "";

    const countryFull = o.origin_country ? toUaCountry(o.origin_country) : "";
    const tailParts: string[] = [];
    if (countryFull) tailParts.push(countryFull);
    if (o.variety) tailParts.push(o.variety);
    const tail = tailParts.length ? ` · ${tailParts.join(" · ")}` : "";

    const apprQty = r?.approved_pallets != null ? Number(r.approved_pallets) : null;
    const reqQty = r?.requested_pallets != null ? Number(r.requested_pallets) : 0;
    const offered = o.offered_pallets != null ? Number(o.offered_pallets) : null;
    const linkedQty = r
      ? Number((r as ManagerOfferResponse & { linked_pallets?: number }).linked_pallets ?? 0)
      : 0;

    let palletNode: ReactNode = null;
    if (bucket === "confirmed") {
      const remaining = apprQty != null && apprQty > 0 ? Math.max(apprQty - linkedQty, 0) : 0;
      const shown = remaining > 0 ? remaining : (apprQty ?? 0);
      if (shown > 0) palletNode = <>{shown}п</>;
    } else {
      if (apprQty != null && apprQty > 0) palletNode = <>{apprQty}п</>;
      else if (offered != null && reqQty > 0)
        palletNode = (
          <>
            <span>{offered}п</span>
            <span className="ml-1 text-warning">·{reqQty}п</span>
          </>
        );
      else if (reqQty > 0) palletNode = <span className="text-warning">{reqQty}п</span>;
      else if (offered != null) palletNode = <>{offered}п</>;
    }

    const details = [o.variety, o.caliber, o.packaging, o.specification].filter(Boolean).join(" • ");
    const indDelta =
      o.prev_indicative_cost_usd != null
        ? Number(o.indicative_cost_usd ?? 0) - Number(o.prev_indicative_cost_usd)
        : 0;
    const invDelta =
      o.prev_invoice_cost_usd != null
        ? Number(o.invoice_cost_usd ?? 0) - Number(o.prev_invoice_cost_usd)
        : 0;

    const cancelledSupply = o.status === "deleted";
    const st = getBranchOfferStatus(o, r ?? null, ship?.code ?? null);
    const responseLocked = !!r && (r.approved_pallets != null || (r as any).refused_at != null);
    const offerInactive = o.status !== "active";
    const inputVisible = !responseLocked && !offerInactive && bucket === "active";
    const draft = drafts[o.id] ?? (r ? String(r.requested_pallets) : "");
    const canCancel =
      bucket === "active" &&
      r && o.status === "active" && r.approved_pallets == null && (r as any).refused_at == null;

    // Активні: NO UAH price displayed. Show USD costs only in confirmed.
    const lines: MobileGlassRow["level2"] = {
      lines: [
        ...(etaIso ? [{ id: "eta", left: "Очікувана дата", right: fmtDate(etaIso), rightTone: "sky" as const }] : []),
        { id: "st", left: "Статус", right: st.label },
        ...(details ? [{ id: "det", left: "Опис", right: details }] : []),
        ...(mgrRaw ? [{ id: "mgr", left: "Менеджер", right: mgrRaw }] : []),
        ...(o.offered_pallets != null
          ? [{ id: "avail", left: "Доступно", right: `${o.offered_pallets}п` }]
          : []),
        ...(bucket === "confirmed"
          ? [{
              id: "cost",
              left: "Собівартість",
              right: (
                <span>
                  <span className="text-success">${Number(o.indicative_cost_usd ?? 0).toFixed(2)}</span>
                  {" / "}
                  <span className="text-destructive">${Number(o.invoice_cost_usd ?? 0).toFixed(2)}</span>
                </span>
              ),
            }]
          : []),
        ...(indDelta && o.prev_indicative_cost_usd != null && bucket === "confirmed"
          ? [{
              id: "d-ind",
              left: "Індикатив змінено",
              right: `$${Number(o.prev_indicative_cost_usd).toFixed(2)} → $${Number(o.indicative_cost_usd ?? 0).toFixed(2)}`,
              rightTone: "warning" as const,
            }]
          : []),
        ...(invDelta && o.prev_invoice_cost_usd != null && bucket === "confirmed"
          ? [{
              id: "d-inv",
              left: "Інвойс змінено",
              right: `$${Number(o.prev_invoice_cost_usd).toFixed(2)} → $${Number(o.invoice_cost_usd ?? 0).toFixed(2)}`,
              rightTone: "warning" as const,
            }]
          : []),
        ...(ship && isRealShipmentCode(ship.code)
          ? [{ id: "sh", left: "Поставка", right: ship.code, rightTone: "success" as const }]
          : []),
      ],
      actions: (ctx): ReactNode => (
        <div className={cn("space-y-2", cancelledSupply && "opacity-70")}>
          {inputVisible ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-sm">
                <span className="mb-1 block opacity-70">Бажана кількість, палет</span>
                <Input
                  type="number"
                  min={0}
                  className="h-9 w-32 font-bold tabular-nums"
                  value={draft}
                  onChange={(e) => { onDraftChange(o.id, e.target.value); ctx.requestMeasure(); }}
                />
              </label>
              <Button
                size="sm"
                disabled={submitting}
                onClick={() => {
                  const n = Number(draft);
                  if (!Number.isFinite(n) || n <= 0) return;
                  onSubmit(o.id, n);
                }}
              >
                {r ? "Оновити" : "Запитати"}
              </Button>
              {canCancel ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  disabled={cancelling}
                  onClick={() => onCancel(r!.id)}
                >
                  Скасувати запит
                </Button>
              ) : null}
            </div>
          ) : null}
          {r ? (
            <div className="text-right text-sm">
              <div className="opacity-70">
                Запит: <b>{reqQty}</b>
              </div>
              {apprQty != null ? (
                <div className="opacity-70">
                  Підтверджено: <b>{apprQty === reqQty ? `${apprQty}` : `${apprQty} з ${reqQty}`}</b>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ),
    };

    return {
      id: o.id,
      level1: {
        mainLeft: (
          <>
            <strong>{o.product_name}</strong>
            {tail ? <span>{tail}</span> : null}
          </>
        ),
        mainRight: palletNode,
        metaLeft: (
          <>
            <span className="font-mono">ETA {fmtEtaShort(etaIso)}</span>
            {mgrRaw ? <span> · {mgrRaw}</span> : null}
          </>
        ),
        // Активні: hide cost pair; Підтверджені: show it.
        metaRight:
          bucket === "confirmed"
            ? <CostPair indicative={o.indicative_cost_usd} invoice={o.invoice_cost_usd} size="xs" />
            : null,
      },
      level2: lines,
    };
  });

  return (
    <MobileGlassTable
      rows={glassRows}
      theme="inherit"
      summary={false}
      emptyState={bucket === "active" ? "Немає активних пропозицій" : "Немає підтверджених пропозицій"}
      topSnap
    />
  );
}

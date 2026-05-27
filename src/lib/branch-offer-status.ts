// Single source of truth for the computed status of a row in the branch
// "Пропозиції ЗЕД" list (table + detail). Keep the rules here ONLY — UI must
// never derive its own label/color from raw fields.
//
// Inputs are read-only. No SQL, no RLS, no schema.

import type { ManagerOffer, ManagerOfferResponse } from "@/lib/manager-offers";

export function isRealShipmentCode(code: string | null | undefined): boolean {
  if (!code) return false;
  const t = code.trim();
  if (!t) return false;
  if (t === "—" || t === "-") return false;
  return true;
}

export type BranchOfferTone = "muted" | "yellow" | "green" | "red";

export type BranchOfferStatusKind =
  | "cancelled"     // supply itself was deleted/cancelled
  | "rejected"      // manager answered 0
  | "confirmed"     // approved_pallets > 0
  | "waiting"       // request sent, no answer yet
  | "shipped"       // real shipment code exists → not an active proposal
  | "none";         // branch has not requested anything

export type BranchOfferStatus = {
  kind: BranchOfferStatusKind;
  label: string;
  tone: BranchOfferTone;
  reqQty: number;       // 0 when no response
  apprQty: number | null; // null when not answered yet
  /** Approved differs from requested in a way that matters for display. */
  partial: boolean;
  hasRealShipment: boolean;
};

export function getBranchOfferStatus(
  offer: Pick<ManagerOffer, "status">,
  response: Pick<ManagerOfferResponse, "requested_pallets" | "approved_pallets"> | null | undefined,
  shipmentCode: string | null | undefined,
): BranchOfferStatus {
  const reqQty = response ? Number(response.requested_pallets) : 0;
  const apprQty =
    response && response.approved_pallets != null ? Number(response.approved_pallets) : null;
  const hasRealShipment = isRealShipmentCode(shipmentCode);

  if (offer.status === "deleted") {
    return {
      kind: "cancelled",
      label: "Скасовано",
      tone: "red",
      reqQty,
      apprQty,
      partial: false,
      hasRealShipment,
    };
  }

  if (hasRealShipment) {
    // Has a real shipment code — no longer an active proposal row.
    return {
      kind: "shipped",
      label: "У поставці",
      tone: "muted",
      reqQty,
      apprQty,
      partial: false,
      hasRealShipment,
    };
  }

  if (!response) {
    return {
      kind: "none",
      label: "—",
      tone: "muted",
      reqQty: 0,
      apprQty: null,
      partial: false,
      hasRealShipment,
    };
  }

  if (apprQty === 0) {
    return {
      kind: "rejected",
      label: "Відмовлено",
      tone: "red",
      reqQty,
      apprQty,
      partial: false,
      hasRealShipment,
    };
  }

  if (apprQty != null && apprQty > 0) {
    const partial = apprQty !== reqQty;
    return {
      kind: "confirmed",
      label: partial ? `Підтв. ${apprQty}/${reqQty}` : `Підтв. ${apprQty}`,
      tone: "green",
      reqQty,
      apprQty,
      partial,
      hasRealShipment,
    };
  }

  return {
    kind: "waiting",
    label: `Чекаю ${reqQty}`,
    tone: "yellow",
    reqQty,
    apprQty: null,
    partial: false,
    hasRealShipment,
  };
}

export function toneClass(tone: BranchOfferTone): string {
  switch (tone) {
    case "green":
      return "bg-success/15 text-success";
    case "yellow":
      return "bg-warning/15 text-warning";
    case "red":
      return "bg-destructive/15 text-destructive";
    default:
      return "bg-muted text-muted-foreground";
  }
}

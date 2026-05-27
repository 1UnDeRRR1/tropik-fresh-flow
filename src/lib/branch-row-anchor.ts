// Branch row → position_id read-model (Block 0.5, helper-only).
//
// CONTRACT — locked, do not relax:
//   `position_id` is the only operational product anchor. This helper
//   resolves it for branch dashboard rows using ONLY explicit links.
//
//   ALLOWED resolution paths:
//     1. manager_offers.position_id                       (offer rows)
//     2. shipment_items.linked_offer_id
//          → manager_offers.position_id                   (materialized rows;
//                                                          temporary bridge
//                                                          until shipment_items
//                                                          gains its own
//                                                          position_id column)
//
//   FORBIDDEN — never infer position_id from any of:
//     - product_id / product_name / variety / caliber / brand / class
//     - origin_country / country text / country alias
//     - supplier / supplier_id / supplier text
//     - position_shipment_links (no shipment_item_id column → not row-level)
//     - any similarity / best-effort / fuzzy match
//
//   If no allowed path resolves → positionId = null, row is legacy-only.
//   Legacy-only rows are NEVER fixed or guessed here; they are surfaced as-is
//   so downstream code / future backend work can address them explicitly.
//
// SCOPE: read-model only. No UI changes. No SQL. No RLS. No migrations.
// This module has zero side effects beyond returning anchors and counting them.

export type ResolutionSource =
  | "manager_offers.position_id" // pending/confirmed offer rows
  | "shipment_items.linked_offer_id->manager_offers.position_id" // materialized via offer bridge
  | "none"; // legacy-only

export type RowAnchor = {
  positionId: string | null;
  resolutionSource: ResolutionSource;
  legacyKeys: {
    shipmentItemId?: string;
    distributionItemId?: string;
    offerId?: string;
    responseId?: string;
    shipmentId?: string;
    supplierId?: string;
  };
};

// ---- Inputs (shape-only; no DB calls inside this module) -------------------

/** Minimal shape needed from a `manager_offers` row. */
export type OfferLike = {
  id: string;
  position_id?: string | null;
};

/** Minimal shape needed from a `shipment_items` row. */
export type ShipmentItemLike = {
  id: string;
  linked_offer_id?: string | null;
  // NOTE: `position_id` intentionally typed but expected to be undefined today;
  // schema does not have it yet. When backend adds it, this helper will start
  // using it as the primary source automatically (see resolveMaterialized).
  position_id?: string | null;
};

// ---- Resolvers -------------------------------------------------------------

/**
 * Resolve a pending/confirmed offer row (Пропозиції / awaiting shipment code).
 * Identity comes from `manager_offers.position_id` only.
 */
export function resolveOfferRow(args: {
  offer: OfferLike;
  responseId?: string;
}): RowAnchor {
  const pid = args.offer.position_id ?? null;
  return {
    positionId: pid,
    resolutionSource: pid ? "manager_offers.position_id" : "none",
    legacyKeys: {
      offerId: args.offer.id,
      responseId: args.responseId,
    },
  };
}

/**
 * Resolve a materialized shipment row (Головна).
 *
 * Primary  : shipment_items.position_id        (column does not exist today;
 *                                               will activate when backend
 *                                               adds it — no code change needed)
 * Secondary: shipment_items.linked_offer_id → manager_offers.position_id
 *            (explicit FK chain written by the offer→shipment RPC)
 * Else     : legacy-only.
 */
export function resolveMaterializedRow(args: {
  item: ShipmentItemLike;
  /** Lookup of manager_offers by id, populated from the same page fetch. */
  offerById: ReadonlyMap<string, OfferLike>;
  distributionItemId?: string;
  shipmentId?: string;
  supplierId?: string;
}): RowAnchor {
  const legacyKeys: RowAnchor["legacyKeys"] = {
    shipmentItemId: args.item.id,
    distributionItemId: args.distributionItemId,
    shipmentId: args.shipmentId,
    supplierId: args.supplierId,
  };

  // Primary — currently inert (column absent), kept for forward-compat.
  if (args.item.position_id) {
    return {
      positionId: args.item.position_id,
      // Reuse the offer-bridge label only if we ever need to distinguish;
      // for now the only live source is the bridge below.
      resolutionSource: "manager_offers.position_id",
      legacyKeys,
    };
  }

  // Secondary — explicit FK chain, no text matching.
  const offerId = args.item.linked_offer_id;
  if (offerId) {
    const offer = args.offerById.get(offerId);
    if (offer?.position_id) {
      return {
        positionId: offer.position_id,
        resolutionSource:
          "shipment_items.linked_offer_id->manager_offers.position_id",
        legacyKeys: { ...legacyKeys, offerId: offer.id },
      };
    }
  }

  return { positionId: null, resolutionSource: "none", legacyKeys };
}

// ---- Diagnostics -----------------------------------------------------------

export type AnchorSummary = {
  total: number;
  withPositionId: number;
  legacyOnly: number;
  pctWithPositionId: number;
  pctLegacyOnly: number;
  bySource: Record<ResolutionSource, number>;
};

export function summarizeAnchors(anchors: ReadonlyArray<RowAnchor>): AnchorSummary {
  const bySource: Record<ResolutionSource, number> = {
    "manager_offers.position_id": 0,
    "shipment_items.linked_offer_id->manager_offers.position_id": 0,
    none: 0,
  };
  let withPid = 0;
  for (const a of anchors) {
    bySource[a.resolutionSource] += 1;
    if (a.positionId) withPid += 1;
  }
  const total = anchors.length;
  const legacyOnly = total - withPid;
  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 1000) / 10);
  return {
    total,
    withPositionId: withPid,
    legacyOnly,
    pctWithPositionId: pct(withPid),
    pctLegacyOnly: pct(legacyOnly),
    bySource,
  };
}

/**
 * Dev-only console log of resolution coverage. No-op in production builds.
 * Call once per page-data fetch; never log row contents, only counts.
 */
export function logAnchorCoverage(scope: string, anchors: ReadonlyArray<RowAnchor>): void {
  if (typeof window === "undefined") return;
  if (!import.meta.env?.DEV) return;
  const s = summarizeAnchors(anchors);
  // eslint-disable-next-line no-console
  console.info(
    `[branch-row-anchor] ${scope}: total=${s.total} withPositionId=${s.withPositionId} (${s.pctWithPositionId}%) legacyOnly=${s.legacyOnly} (${s.pctLegacyOnly}%) bySource=`,
    s.bySource,
  );
}

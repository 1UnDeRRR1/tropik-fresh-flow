// Canonical formula for "open remaining" pallets on a manager offer response.
//
// Business invariant (Build: cancel remaining as position lifecycle event):
//   approved  = manager_offer_responses.approved_pallets
//   ordered   = Σ manager_offer_allocation_parts.pallets WHERE status='ordered'
//   cancelled = Σ manager_offer_allocation_parts.pallets WHERE status='cancelled'
//   open      = max(approved - ordered - cancelled, 0)
//
// MUST be used by every screen/query that decides whether a response still has
// unlinked pallets. Never compute `open = approved - linked` on its own — that
// ignores manager-cancelled remainder and re-opens quantity that was closed.
//
// `manager_offer_responses.linked_pallets` is maintained by
// `sync_manager_offer_distribution` as SUM(pallets WHERE status='ordered'),
// so it is equivalent to `ordered` and may be used as a substitute for the
// ordered term when a parts-level count is not available. The `cancelled`
// term must still be subtracted separately.
//
// No new tables, no new columns.

export type RemainingInput = {
  approved: number | null | undefined;
  ordered: number | null | undefined;
  cancelled: number | null | undefined;
};

export type RemainingResult = {
  approved: number;
  ordered: number;
  cancelled: number;
  open: number;
};

const toNum = (v: number | null | undefined) =>
  v == null || !Number.isFinite(Number(v)) ? 0 : Number(v);

export function computeOfferRemaining(input: RemainingInput): RemainingResult {
  const approved = toNum(input.approved);
  const ordered = toNum(input.ordered);
  const cancelled = toNum(input.cancelled);
  const open = Math.max(approved - ordered - cancelled, 0);
  return { approved, ordered, cancelled, open };
}

/** Sum canonical remaining across many responses. */
export function sumOfferRemaining(rows: ReadonlyArray<RemainingInput>): RemainingResult {
  return rows.reduce<RemainingResult>(
    (acc, r) => {
      const x = computeOfferRemaining(r);
      return {
        approved: acc.approved + x.approved,
        ordered: acc.ordered + x.ordered,
        cancelled: acc.cancelled + x.cancelled,
        open: acc.open + x.open,
      };
    },
    { approved: 0, ordered: 0, cancelled: 0, open: 0 },
  );
}

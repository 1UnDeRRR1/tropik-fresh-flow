// Centralized helper for counting "positions" across the system.
//
// Two related counts are exposed everywhere position counts are shown:
//   - base:  unique products IGNORING country (e.g. "Апельсин" once,
//            no matter how many countries it comes from)
//   - total: actual positions including country split (current behaviour,
//            unchanged — Апельсин Іспанія + Апельсин Італія = 2)
//
// Display format is always: `${base} / ${total}` (e.g. "1 / 3", "3 / 9").

export type PositionCount = { base: number; total: number };

function normalizeProduct(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

/**
 * Count positions from a flat list of items.
 * Each item contributes 1 to `total`; unique normalized product names
 * contribute to `base` (country is intentionally ignored).
 */
export function countPositions<T>(
  items: ReadonlyArray<T>,
  getProductName: (item: T) => string | null | undefined,
): PositionCount {
  const baseSet = new Set<string>();
  let total = 0;
  for (const it of items) {
    const name = normalizeProduct(getProductName(it));
    if (!name) continue;
    baseSet.add(name);
    total += 1;
  }
  return { base: baseSet.size, total };
}

/**
 * Count positions from already grouped rows (e.g. product+country groups).
 * `total` is the number of groups; `base` is the number of unique products.
 */
export function countPositionsFromGroups<T>(
  groups: ReadonlyArray<T>,
  getProductName: (group: T) => string | null | undefined,
): PositionCount {
  const baseSet = new Set<string>();
  for (const g of groups) {
    const name = normalizeProduct(getProductName(g));
    if (!name) continue;
    baseSet.add(name);
  }
  return { base: baseSet.size, total: groups.length };
}

/** "1 / 3" — universal display format for position counters. */
export function formatPositions(p: PositionCount): string {
  return `${p.base} / ${p.total}`;
}

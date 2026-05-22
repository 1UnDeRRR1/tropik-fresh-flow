// Patch 6B — frontend customs status helpers.
// Centralizes derivation of GREEN/YELLOW/RED state and the exact Ukrainian
// strings used by the chip and manual-override widgets.

import type { CustomsRefRow } from "./offer-cost";

export type CustomsStatus = "green" | "yellow" | "red";

export const CUSTOMS_STRINGS = {
  green: "Митна база: знайдено",
  yellow:
    "Митна база: країну не знайдено, використано найвищий розрахунок по товару",
  redTitle: "Митна база: товар не знайдено",
  redSubtitle: "Розрахунок виконано без митної складової",
  manualLabel: "Ручна сума митного збору, USD/кг",
  manualConfirm: "Підтвердити ручну суму митного збору",
  manualConfirmedPrefix: "вручну підтверджено:",
  blockedByBranchActivity:
    "Цю активну пропозицію вже бачать/обробляють філії. Зміну товару або країни заблоковано. Створіть нову пропозицію.",
  publishBlockedActiveRed:
    "Потрібно підтвердити ручну суму митного збору перед збереженням активної пропозиції.",
  publishBlockedDraftRed:
    "Потрібна підтверджена ручна сума митного збору",
  shipmentDoneRedSuffix: "без підтвердженої ручної суми митного збору",
} as const;

/** Derive status from a manager-offer-side customs_reference lookup result. */
export function getCustomsStatusFromRef(
  ref: CustomsRefRow | null | undefined,
): CustomsStatus {
  if (!ref) return "red";
  return ref.exact === true ? "green" : "yellow";
}

/** Derive status from a shipment_item using its customs_match_id +
 * the matched customs_reference row (id, country) + the item's own country.
 * - No match row at all → RED.
 * - Match country equals item country → GREEN.
 * - Match exists but country differs (fallback/highest indicative) → YELLOW.
 */
export function getCustomsStatusFromMatch(
  matchId: string | null | undefined,
  matchCountry: string | null | undefined,
  itemCountry: string | null | undefined,
): CustomsStatus {
  if (!matchId) return "red";
  const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
  return norm(matchCountry) === norm(itemCountry) ? "green" : "yellow";
}

// src/lib/commit-shipment-row.ts
//
// Build 2A — thin extraction of the per-row commit sequence from
// $id.products.tsx (lines 1600-1669 in the original file). This is the
// SAME logic the committed-shipment editor runs when inserting a new
// shipment_item: create position → insert item → attach position → optional
// FIFO offer link. Extracting it lets `/shipments/new` reuse the
// authoritative path instead of duplicating it.
//
// Strict rules:
//   * No new RPCs. Same Supabase calls as today.
//   * No position_id minting outside `createPositionForShipmentItem`.
//   * Rolls back inserted shipment_item if attach or FIFO fails.
//   * Returns `createdPositionId` so the caller (already responsible for
//     larger rollback context — vehicle/shipment) can call
//     `rollbackBirthPosition` itself, exactly like commitDraft does today.
//   * Caller must build the INSERT payload (with shipment_id set) so that
//     the existing buildPayload behavior in $id.products.tsx is preserved
//     verbatim.

import { supabase } from "@/integrations/supabase/client";
import {
  createPositionForShipmentItem,
  attachShipmentItemToPosition,
} from "@/lib/position-attach";
import { translateError } from "@/lib/mutation-helpers";

export type CommitNewShipmentItemDraft = {
  localId: string;
  source_offer_id: string | null | undefined;
  source_position_id: string | null | undefined;
  product_name: string;
  origin_country: string;
  caliber: string;
  package_used: string;
  pallet_count: number;
};

export type CommitNewShipmentItemInput = {
  shipmentId: string;
  draft: CommitNewShipmentItemDraft;
  /** Pre-built INSERT payload from buildPayload({forUpdate:false}). Must contain shipment_id. */
  payload: Record<string, unknown>;
  responsibleManagerId: string | null;
};

export type CommitNewShipmentItemResult =
  | {
      ok: true;
      itemId: string;
      positionId: string;
      /** Non-null iff this call created a fresh position (manual row).
       *  Caller may push it onto a rollback list. */
      createdPositionId: string | null;
    }
  | {
      ok: false;
      reason: string;
      /** Non-null iff a position was created BEFORE the failure. Caller is
       *  responsible for calling rollbackBirthPosition. */
      createdPositionId: string | null;
    };

export async function commitNewShipmentItem(
  input: CommitNewShipmentItemInput,
): Promise<CommitNewShipmentItemResult> {
  const { shipmentId, draft, payload, responsibleManagerId } = input;

  // 1. Position. Offer-prefilled rows reuse the offer's position_id;
  //    manual rows create a fresh draft position.
  let positionId = draft.source_position_id ?? null;
  let createdPositionId: string | null = null;
  if (!positionId) {
    const posRes = await createPositionForShipmentItem({
      productName: draft.product_name,
      originCountry: draft.origin_country,
      sourceContext: "shipment_item_manual",
      sourceRowKey: `${shipmentId}:${draft.localId}`,
      clientRowId: draft.localId.replace(/^tmp_/, ""),
      caliber: draft.caliber || null,
      packaging: draft.package_used || null,
      responsibleManagerId: responsibleManagerId ?? null,
      palletQty: draft.pallet_count > 0 ? draft.pallet_count : null,
    });
    if (!posRes.ok) {
      const reason =
        posRes.stage === "resolve_product"
          ? "Товар не розпізнано. Уточніть назву товару."
          : posRes.stage === "resolve_country"
            ? "Країну не розпізнано. Уточніть країну."
            : `Не вдалося створити позицію: ${posRes.reason}`;
      return { ok: false, reason, createdPositionId: null };
    }
    positionId = posRes.positionId;
    createdPositionId = positionId;
  }

  // 2. Insert the shipment_item.
  const { data: insRow, error: insErr } = await supabase
    .from("shipment_items")
    .insert(payload as never)
    .select("id")
    .single();
  if (insErr || !insRow) {
    return {
      ok: false,
      reason: translateError(insErr ?? new Error("insert_failed")),
      createdPositionId,
    };
  }
  const itemId = (insRow as { id: string }).id;

  // 3. Attach to position + verify shipment_items.position_id.
  const attachRes = await attachShipmentItemToPosition({
    shipmentItemId: itemId,
    positionId,
    palletQty: draft.pallet_count > 0 ? draft.pallet_count : null,
  });
  if (!attachRes.ok) {
    await supabase.from("shipment_items").delete().eq("id", itemId);
    return {
      ok: false,
      reason: `Не вдалося прив'язати позицію (${attachRes.stage}): ${attachRes.reason}`,
      createdPositionId,
    };
  }

  // 4. Optional FIFO offer link.
  if (draft.source_offer_id) {
    const { error: fifoErr } = await supabase.rpc(
      "link_offer_to_shipment_item_fifo",
      {
        p_offer_id: draft.source_offer_id,
        p_shipment_item_id: itemId,
        p_max_pallets: draft.pallet_count,
        p_allow_caliber_mismatch: false,
        p_notes: undefined,
      },
    );
    if (fifoErr) {
      await supabase.from("shipment_items").delete().eq("id", itemId);
      return {
        ok: false,
        reason: `Не вдалося прив'язати пропозицію: ${translateError(fifoErr)}`,
        createdPositionId,
      };
    }
  }

  return { ok: true, itemId, positionId, createdPositionId };
}

import { supabase } from "@/integrations/supabase/client";

/**
 * Safely delete a shipment ONLY when it is a truly empty technical draft.
 *
 * A shipment is eligible for hard delete only if ALL of the following hold:
 *   - shipments.status === 'draft';
 *   - no shipment_items with a real product_name (real = non-empty and not "Новий товар");
 *   - no shipment_items with pallet_count > 0;
 *   - no shipment_items with position_id set;
 *   - no manager_offer_shipment_links referencing any of its shipment_items;
 *   - no manager_offer_allocation_parts referencing the shipment or its items;
 *   - no distributions referencing the shipment;
 *   - no distribution_items referencing any of its shipment_items;
 *   - no archive_promise_snapshots.source_shipment_id = id;
 *   - no archive_promise_snapshots reachable via source_offer_id linked to this shipment's items;
 *   - no branch_archive_results.shipment_id = id;
 *   - no position_shipment_links.shipment_id = id;
 *   - no manager_offers.linked_shipment_id = id back-reference.
 *
 * No destructive write happens before ALL probes pass. Any probe error =>
 * fail closed (return false). This helper NEVER calls the cancelled-archive
 * writer; business-linked cancellation belongs to cancelShipment().
 *
 * Returns true if the shipment was hard-deleted.
 */
export async function deleteShipmentIfEmpty(shipmentId: string): Promise<boolean> {
  if (!shipmentId) return false;

  // 1. Load shipment (status + vehicle).
  const { data: ship, error: shipErr } = await supabase
    .from("shipments")
    .select("id, status, vehicle_id")
    .eq("id", shipmentId)
    .maybeSingle();
  if (shipErr || !ship) return false;
  if (ship.status !== "draft") return false;
  const vehicleId = (ship as { vehicle_id: string | null }).vehicle_id ?? null;

  // 2. Load items.
  const { data: items, error: itemsErr } = await supabase
    .from("shipment_items")
    .select("id, product_name, pallet_count, position_id")
    .eq("shipment_id", shipmentId);
  if (itemsErr) return false;
  const itemRows = items ?? [];

  // 3. Reject if any item has real data or position linkage.
  for (const i of itemRows) {
    const name = (i.product_name ?? "").trim();
    const realName = name.length > 0 && name !== "Новий товар";
    if (realName) return false;
    if (Number(i.pallet_count ?? 0) > 0) return false;
    if (i.position_id) return false;
  }

  const itemIds = itemRows.map((i) => i.id);

  // 4. Business-link probes — fail closed on error, bail on any hit.
  const probe = async (
    q: PromiseLike<{ data: unknown; error: unknown }>,
  ): Promise<"empty" | "hit" | "error"> => {
    try {
      const { data, error } = await q;
      if (error) return "error";
      if (Array.isArray(data) ? data.length > 0 : !!data) return "hit";
      return "empty";
    } catch {
      return "error";
    }
  };

  // 4a. manager_offer_shipment_links — only shipment_item_id exists on this table.
  if (itemIds.length > 0) {
    const r = await probe(
      supabase
        .from("manager_offer_shipment_links")
        .select("id, offer_id")
        .in("shipment_item_id", itemIds)
        .limit(50),
    );
    if (r !== "empty") return false;

    // 4f. archive_promise_snapshots via source_offer_id reachable from this shipment's links.
    // First collect offer_ids from links (if any). We already know links are empty here
    // (would have bailed above), so nothing to probe via source_offer_id at this point.
  }

  // 4b. manager_offer_allocation_parts by shipment_id.
  {
    const r = await probe(
      supabase
        .from("manager_offer_allocation_parts")
        .select("id")
        .eq("shipment_id", shipmentId)
        .limit(1),
    );
    if (r !== "empty") return false;
  }

  // 4b-bis. manager_offer_allocation_parts by shipment_item_id.
  if (itemIds.length > 0) {
    const r = await probe(
      supabase
        .from("manager_offer_allocation_parts")
        .select("id")
        .in("shipment_item_id", itemIds)
        .limit(1),
    );
    if (r !== "empty") return false;
  }

  // 4c. distributions by shipment_id.
  {
    const r = await probe(
      supabase
        .from("distributions")
        .select("id")
        .eq("shipment_id", shipmentId)
        .limit(1),
    );
    if (r !== "empty") return false;
  }

  // 4d. distribution_items by shipment_item_id.
  if (itemIds.length > 0) {
    const r = await probe(
      supabase
        .from("distribution_items")
        .select("id")
        .in("shipment_item_id", itemIds)
        .limit(1),
    );
    if (r !== "empty") return false;
  }

  // 4e. archive_promise_snapshots.source_shipment_id.
  {
    const r = await probe(
      supabase
        .from("archive_promise_snapshots")
        .select("id")
        .eq("source_shipment_id", shipmentId)
        .limit(1),
    );
    if (r !== "empty") return false;
  }

  // 4g. branch_archive_results.shipment_id.
  {
    const r = await probe(
      supabase
        .from("branch_archive_results")
        .select("result_id")
        .eq("shipment_id", shipmentId)
        .limit(1),
    );
    if (r !== "empty") return false;
  }

  // 4h. position_shipment_links.shipment_id.
  {
    const r = await probe(
      supabase
        .from("position_shipment_links")
        .select("id")
        .eq("shipment_id", shipmentId)
        .limit(1),
    );
    if (r !== "empty") return false;
  }

  // 4i. manager_offers back-reference (linked_shipment_id).
  {
    const r = await probe(
      supabase
        .from("manager_offers")
        .select("id")
        .eq("linked_shipment_id", shipmentId)
        .limit(1),
    );
    if (r !== "empty") return false;
  }

  // NOTE: loading_plan has no shipment_id column in the current schema, so
  // there is nothing to probe there.

  // 5. All checks passed — safe to delete the truly empty draft.
  if (itemIds.length > 0) {
    const { error: delItemsErr } = await supabase
      .from("shipment_items")
      .delete()
      .in("id", itemIds);
    if (delItemsErr) return false;
  }

  const { error: delShipErr } = await supabase
    .from("shipments")
    .delete()
    .eq("id", shipmentId);
  if (delShipErr) return false;

  if (vehicleId) {
    const { data: rest } = await supabase
      .from("shipments")
      .select("id")
      .eq("vehicle_id", vehicleId)
      .limit(1);
    if (!rest || rest.length === 0) {
      await supabase.from("vehicles" as never).delete().eq("id", vehicleId);
    }
  }
  return true;
}

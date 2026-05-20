import { supabase } from "@/integrations/supabase/client";

/**
 * Delete a shipment only when it has no meaningful draft data and no items with pallet_count > 0.
 * If, after deletion, the parent vehicle has no shipments left, delete the vehicle too.
 * Returns true if shipment was deleted.
 */
export async function deleteShipmentIfEmpty(shipmentId: string): Promise<boolean> {
  if (!shipmentId) return false;
  const { data: items } = await supabase
    .from("shipment_items")
    .select("id, product_name, pallet_count")
    .eq("shipment_id", shipmentId);

  const invalidIds = (items ?? [])
    .filter((i) => {
      const name = (i.product_name ?? "").trim();
      const isEmptyName = name.length === 0 || name === "Новий товар";
      return isEmptyName || Number(i.pallet_count ?? 0) <= 0;
    })
    .map((i) => i.id);


  if (invalidIds.length > 0) {
    await supabase.from("shipment_items").delete().in("id", invalidIds);
  }

  const hasReal = (items ?? []).some(
    (i) => (i.product_name ?? "").trim().length > 0 && Number(i.pallet_count ?? 0) > 0,
  );
  if (hasReal) return false;

  const hasDraftData = (items ?? []).some(
    (i) => (i.product_name ?? "").trim().length > 0 || Number(i.pallet_count ?? 0) > 0,
  );
  if (hasDraftData) return false;

  // Get vehicle_id before delete
  const { data: ship } = await supabase
    .from("shipments")
    .select("vehicle_id")
    .eq("id", shipmentId)
    .maybeSingle();
  const vehicleId = (ship as { vehicle_id: string | null } | null)?.vehicle_id ?? null;

  // Delete empty rows first (qty=0 placeholders) then shipment
  await supabase.from("shipment_items").delete().eq("shipment_id", shipmentId);
  const { error } = await supabase.from("shipments").delete().eq("id", shipmentId);
  if (error) return false;

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

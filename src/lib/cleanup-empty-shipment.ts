import { supabase } from "@/integrations/supabase/client";

/**
 * Delete a shipment if it has no items with pallet_count > 0.
 * If, after deletion, the parent vehicle has no shipments left, delete the vehicle too.
 * Returns true if shipment was deleted.
 */
export async function deleteShipmentIfEmpty(shipmentId: string): Promise<boolean> {
  if (!shipmentId) return false;
  const { data: items } = await supabase
    .from("shipment_items")
    .select("pallet_count")
    .eq("shipment_id", shipmentId);
  const hasReal = (items ?? []).some((i) => Number(i.pallet_count ?? 0) > 0);
  if (hasReal) return false;

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

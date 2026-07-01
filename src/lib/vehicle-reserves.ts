// Build 2E-B — thin wrappers for the vehicle_reserves foundation from 2E-A.
//
// DB/RLS/RPC are NOT modified in this build. This module only:
//   * calls the three existing SECURITY DEFINER RPCs
//     (create_vehicle_reserve, release_vehicle_reserve, close_vehicle_reserves)
//   * runs read-only SELECTs against public.vehicle_reserves filtered to
//     status='active' for UI display and capacity checks.
//
// Note: SELECT on vehicle_reserves goes directly through PostgREST because
// SELECT is granted to authenticated per the 2E-A policy. Writes are only
// via RPCs (grant EXECUTE to authenticated).

import { supabase } from "@/integrations/supabase/client";

export type ActiveReserve = {
  id: string;
  vehicle_id: string;
  owner_user_id: string;
  pallets: number;
  gross_kg: number;
  note: string | null;
  created_at: string;
};

export async function createVehicleReserve(
  vehicleId: string,
  pallets: number,
  grossKg: number,
  note: string | null,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const { data, error } = await supabase.rpc("create_vehicle_reserve" as never, {
    p_vehicle_id: vehicleId,
    p_pallets: pallets,
    p_gross_kg: grossKg,
    p_note: note && note.trim() ? note.trim() : null,
  } as never);
  if (error) return { ok: false, reason: error.message };
  return { ok: true, id: data as unknown as string };
}

export async function releaseVehicleReserve(
  reserveId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { error } = await supabase.rpc("release_vehicle_reserve" as never, {
    p_reserve_id: reserveId,
  } as never);
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

export async function closeVehicleReserves(
  vehicleId: string,
): Promise<{ ok: true; closed: number } | { ok: false; reason: string }> {
  const { data, error } = await supabase.rpc("close_vehicle_reserves" as never, {
    p_vehicle_id: vehicleId,
  } as never);
  if (error) return { ok: false, reason: error.message };
  return { ok: true, closed: Number(data ?? 0) };
}

/** Fetch active reserves for a batch of vehicle ids (empty ⇒ []). */
export async function fetchActiveReservesByVehicle(
  vehicleIds: string[],
): Promise<ActiveReserve[]> {
  if (vehicleIds.length === 0) return [];
  const { data, error } = await supabase
    .from("vehicle_reserves" as never)
    .select("id,vehicle_id,owner_user_id,pallets,gross_kg,note,created_at")
    .eq("status", "active")
    .in("vehicle_id", vehicleIds);
  if (error) return [];
  return ((data ?? []) as unknown as ActiveReserve[]).map((r) => ({
    ...r,
    pallets: Number(r.pallets ?? 0),
    gross_kg: Number(r.gross_kg ?? 0),
  }));
}

/** Fetch active reserves for a single vehicle. */
export async function fetchActiveReservesForVehicle(
  vehicleId: string,
): Promise<ActiveReserve[]> {
  return fetchActiveReservesByVehicle([vehicleId]);
}

/** Sum helper — returns totals for a set of reserves. */
export function sumReserves(rs: Pick<ActiveReserve, "pallets" | "gross_kg">[]): {
  pallets: number;
  gross_kg: number;
} {
  let pallets = 0;
  let gross_kg = 0;
  for (const r of rs) {
    pallets += Number(r.pallets ?? 0);
    gross_kg += Number(r.gross_kg ?? 0);
  }
  return { pallets, gross_kg };
}

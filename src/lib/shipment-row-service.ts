// Build B — pure data-loading helpers shared by shipment-row editors.
// React Query option factories only. No React, no JSX, no business formulas
// (those live in src/lib/shipment-row-engine.ts).
//
// Error policy: every factory checks the Supabase `error` and throws it. A
// failed customs query must surface as a query error — never collapse into
// empty refs (which would render as a false RED customs result), null FX, or
// empty vehicle context.

import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type {
  ActiveCustomsRef,
  VehicleContextLike,
} from "@/lib/shipment-row-engine";

export function activeCustomsRefsQuery() {
  return queryOptions({
    queryKey: ["customs-reference-active"] as const,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ActiveCustomsRef[]> => {
      const { data, error } = await supabase
        .from("customs_reference")
        .select(
          "id,product_name,country,threshold_price_usd,customs_fee_percent,euro1_markup_usd,euro1_percent",
        )
        .eq("active", true)
        .range(0, 1999);
      if (error) throw error;
      return (data ?? []) as ActiveCustomsRef[];
    },
  });
}

export function latestEurUsdQuery() {
  return queryOptions({
    queryKey: ["fx-eur-usd-latest"] as const,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<number | null> => {
      const { data, error } = await supabase
        .from("exchange_rates")
        .select("rate")
        .eq("base_currency", "EUR")
        .eq("target_currency", "USD")
        .order("rate_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? Number((data as { rate: number }).rate) : null;
    },
  });
}

export function vehicleContextQuery(vehicleId: string | null | undefined) {
  return queryOptions({
    queryKey: ["shipment-row-engine", "vehicle-context", vehicleId ?? null] as const,
    enabled: !!vehicleId,
    staleTime: 30_000,
    queryFn: async (): Promise<VehicleContextLike | null> => {
      if (!vehicleId) return null;
      const [vRes, sRes] = await Promise.all([
        supabase
          .from("vehicles" as never)
          .select("id,total_pallets,status")
          .eq("id", vehicleId)
          .maybeSingle(),
        supabase
          .from("shipments")
          .select("id,logistics_cost_usd")
          .eq("vehicle_id", vehicleId)
          .order("created_at"),
      ]);
      if (vRes.error) throw vRes.error;
      if (sRes.error) throw sRes.error;
      const v = vRes.data;
      if (!v) return null;
      const vehicle = v as { total_pallets: number | null; status: string | null };
      const siblings = sRes.data ?? [];
      const dedup = Array.from(
        new Map(
          siblings.map((row) => [
            row.id,
            {
              id: row.id as string,
              logistics_cost_usd:
                (row as { logistics_cost_usd?: number | null }).logistics_cost_usd ?? null,
            },
          ]),
        ).values(),
      );
      return {
        vehicle: { total_pallets: vehicle.total_pallets },
        vehicleStatus: vehicle.status,
        shipments: dedup,
      };
    },
  });
}

/**
 * Read boxes_per_pallet for a SPECIFIC pallet_standards row, by exact id.
 *
 * The previous draft of this helper guessed a row from
 * (product_label + package_used + limit(1)), which is non-deterministic and
 * ignores country. That lookup has been removed. Callers must pass an exact
 * pallet_standards.id selected by the resolver. Until such an id exists,
 * /shipments/new must show "—" for Ящ./пал.
 */
export function palletStandardBoxesPerPalletByIdQuery(
  palletStandardId: string | null | undefined,
) {
  return queryOptions({
    queryKey: ["shipment-row-engine", "pallet-standard-bpp-by-id", palletStandardId ?? null] as const,
    enabled: !!palletStandardId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<number | null> => {
      if (!palletStandardId) return null;
      const { data, error } = await supabase
        .from("pallet_standards")
        .select("boxes_per_pallet")
        .eq("id", palletStandardId)
        .maybeSingle();
      if (error) throw error;
      const bpp = (data as { boxes_per_pallet?: number | null } | null)?.boxes_per_pallet;
      return bpp != null ? Number(bpp) : null;
    },
  });
}

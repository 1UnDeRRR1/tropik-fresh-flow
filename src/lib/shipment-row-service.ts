// Build B — pure data-loading helpers shared by shipment-row editors.
// React Query option factories only. No React, no JSX, no business formulas
// (those live in src/lib/shipment-row-engine.ts).
//
// Scope (frozen for Build B):
//   * activeCustomsRefsQuery()        — same fetch as $id.products.tsx L627-L638.
//   * latestEurUsdQuery()             — same fetch as $id.products.tsx L641-L655.
//   * vehicleContextQuery(vehicleId)  — minimal context shape used by
//                                       computeRowPreview for new-mode preview
//                                       on /shipments/new (existing-vehicle).
//   * palletStandardBoxesPerPalletQuery(productLabel, packageUsed)
//                                     — read-only boxes_per_pallet for the
//                                       ящ./пал. chip in /shipments/new.
//
// No writes, no schema changes, no new RPCs.

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
      const { data } = await supabase
        .from("customs_reference")
        .select(
          "id,product_name,country,threshold_price_usd,customs_fee_percent,euro1_markup_usd,euro1_percent",
        )
        .eq("active", true)
        .range(0, 1999);
      return (data ?? []) as ActiveCustomsRef[];
    },
  });
}

export function latestEurUsdQuery() {
  return queryOptions({
    queryKey: ["fx-eur-usd-latest"] as const,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<number | null> => {
      const { data } = await supabase
        .from("exchange_rates")
        .select("rate")
        .eq("base_currency", "EUR")
        .eq("target_currency", "USD")
        .order("rate_date", { ascending: false })
        .limit(1)
        .maybeSingle();
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
      const [{ data: v }, { data: siblings }] = await Promise.all([
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
      if (!v) return null;
      const vehicle = v as { total_pallets: number | null; status: string | null };
      // Dedupe shipments by id (same defensive shape used by $id.products.tsx).
      const dedup = Array.from(
        new Map(
          (siblings ?? []).map((row) => [
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

function trimLower(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function palletStandardBoxesPerPalletQuery(
  productLabel: string | null | undefined,
  packageUsed: string | null | undefined,
) {
  const labelKey = trimLower(productLabel);
  const pkgKey = trimLower(packageUsed);
  return queryOptions({
    queryKey: ["shipment-row-engine", "pallet-standard-bpp", labelKey, pkgKey] as const,
    enabled: !!labelKey && !!pkgKey,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<number | null> => {
      if (!labelKey || !pkgKey) return null;
      // Case-insensitive equality on product_label + package_used.
      const { data } = await supabase
        .from("pallet_standards")
        .select("boxes_per_pallet")
        .ilike("product_label", labelKey)
        .ilike("package_used", pkgKey)
        .limit(1)
        .maybeSingle();
      const bpp = (data as { boxes_per_pallet?: number | null } | null)?.boxes_per_pallet;
      return bpp != null ? Number(bpp) : null;
    },
  });
}

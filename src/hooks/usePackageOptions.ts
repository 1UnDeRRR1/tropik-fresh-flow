// Phase 3 — unified pallet/packaging resolver.
//
// Both the dropdown options list and the default (heaviest gross) come from
// a single source of truth: `rpc_pallet_standard_resolve`. Tier order is
// exact → compound_group → all_fallback → no_match. Europe/Overseas regional
// tier is intentionally deferred (no Europe-continent map in `countries`).

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PackageOption = {
  package_used: string;
  pallet_size: string | null;
  pallet_net_kg: number | null;
  pallet_gross_kg: number | null;
};

export type PalletResolverMatchType =
  | "exact"
  | "compound_group"
  | "all_fallback"
  | "no_match";

export type PalletResolverResult = {
  options: PackageOption[];
  matchType: PalletResolverMatchType;
  isFallback: boolean;
  fallbackExplanation: string | null;
};

const EMPTY: PalletResolverResult = {
  options: [],
  matchType: "no_match",
  isFallback: false,
  fallbackExplanation: null,
};

/** Full resolver result (options + fallback metadata). */
export function usePalletResolver(
  productNameUa: string | null | undefined,
  countryNameUa: string | null | undefined,
) {
  const product = (productNameUa ?? "").trim();
  const country = (countryNameUa ?? "").trim();

  return useQuery({
    queryKey: ["pallet-resolve", product.toLowerCase(), country.toLowerCase()],
    enabled: !!product,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<PalletResolverResult> => {
      // Resolve UA product → product_dictionary.id (uuid).
      const { data: dictRows } = await supabase
        .from("product_dictionary")
        .select("id,product_name_ua")
        .eq("product_name_ua", product)
        .limit(1);
      const dictId = dictRows?.[0]?.id as string | undefined;
      if (!dictId) return EMPTY;

      const { data, error } = await supabase.rpc(
        "rpc_pallet_standard_resolve" as never,
        { p_dictionary_id: dictId, p_country: country || null } as never,
      );
      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return EMPTY;

      const rawOptions = (row.options ?? []) as Array<{
        package_used: string | null;
        pallet_size: string | null;
        pallet_net_kg: number | string | null;
        pallet_gross_kg: number | string | null;
      }>;

      const options: PackageOption[] = rawOptions
        .filter((o) => !!o?.package_used)
        .map((o) => ({
          package_used: String(o.package_used),
          pallet_size: o.pallet_size ?? null,
          pallet_net_kg:
            o.pallet_net_kg == null ? null : Number(o.pallet_net_kg),
          pallet_gross_kg:
            o.pallet_gross_kg == null ? null : Number(o.pallet_gross_kg),
        }));

      return {
        options,
        matchType: (row.match_type ?? "no_match") as PalletResolverMatchType,
        isFallback: !!row.is_fallback,
        fallbackExplanation: (row.fallback_explanation ?? null) as
          | string
          | null,
      };
    },
  });
}

/**
 * Back-compat shim used by existing callers that only need the options list.
 * Returns the same shape as before; data flows through the unified RPC.
 */
export function usePackageOptionsFor(
  productNameUa: string | null | undefined,
  countryNameUa: string | null | undefined,
) {
  const q = usePalletResolver(productNameUa, countryNameUa);
  return {
    ...q,
    data: q.data?.options ?? [],
  };
}

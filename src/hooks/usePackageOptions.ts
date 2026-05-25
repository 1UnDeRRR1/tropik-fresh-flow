// Phase 2 — clean pallet_standards-driven package picker.
//
// Returns the list of packaging options (package_used / pallet_size / net /
// gross) for a given Ukrainian product name + Ukrainian country name. Country
// matching uses country_aliases (UA → EN/RU) plus "All origins average" as
// a generic fallback row when present.
//
// Source-of-truth: pallet_standards only. No legacy fallback, no
// products.default_pallet_weight.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PackageOption = {
  package_used: string;
  pallet_size: string | null;
  pallet_net_kg: number | null;
  pallet_gross_kg: number | null;
};

export function usePackageOptionsFor(
  productNameUa: string | null | undefined,
  countryNameUa: string | null | undefined,
) {
  const product = (productNameUa ?? "").trim();
  const country = (countryNameUa ?? "").trim();
  return useQuery({
    queryKey: ["pallet-options", product.toLowerCase(), country.toLowerCase()],
    enabled: !!product,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<PackageOption[]> => {
      // 1) Resolve UA product → canonical_product_id (best-effort).
      const { data: dictRows } = await supabase
        .from("product_dictionary")
        .select("canonical_product_id,product_name_ua")
        .eq("product_name_ua", product)
        .limit(1);
      const canonId = dictRows?.[0]?.canonical_product_id as string | undefined;

      // 2) Build set of EN/RU country forms that map to the chosen UA country.
      const countryForms = new Set<string>();
      if (country) {
        countryForms.add(country.toLowerCase());
        const { data: aliasRows } = await supabase
          .from("country_aliases")
          .select("alias")
          .eq("country_name", country);
        for (const r of aliasRows ?? []) {
          if (r.alias) countryForms.add(String(r.alias).toLowerCase());
        }
      }

      // 3) Pull all pallet_standards rows for this product (by id or label).
      const orParts: string[] = [];
      if (canonId) orParts.push(`canonical_product_id.eq.${canonId}`);
      orParts.push(`product_label.eq.${product.replace(/,/g, "")}`);
      const { data, error } = await supabase
        .from("pallet_standards")
        .select(
          "package_used,pallet_size,pallet_net_kg,pallet_gross_kg,country_en,country_ru,product_label,canonical_product_id",
        )
        .or(orParts.join(","));
      if (error) throw error;

      // 4) Filter by country (or accept generic "all origins" rows).
      const GENERIC = new Set([
        "all origins average",
        "all",
        "усі країни",
        "все страны",
      ]);
      const matched = (data ?? []).filter((r) => {
        if (!country) return true;
        const en = (r.country_en ?? "").toLowerCase();
        const ru = (r.country_ru ?? "").toLowerCase();
        if (GENERIC.has(en) || GENERIC.has(ru)) return true;
        return (en && countryForms.has(en)) || (ru && countryForms.has(ru));
      });


      // 5) De-duplicate identical (package, size, net, gross) tuples.
      const seen = new Set<string>();
      const out: PackageOption[] = [];
      for (const r of matched) {
        if (!r.package_used) continue;
        const key = `${r.package_used}|${r.pallet_size ?? ""}|${r.pallet_net_kg ?? ""}|${r.pallet_gross_kg ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          package_used: r.package_used,
          pallet_size: r.pallet_size,
          pallet_net_kg: r.pallet_net_kg as number | null,
          pallet_gross_kg: r.pallet_gross_kg as number | null,
        });
      }
      // Heaviest gross first (default resolver picks the heaviest).
      out.sort((a, b) => (b.pallet_gross_kg ?? 0) - (a.pallet_gross_kg ?? 0));
      return out;
    },
  });
}

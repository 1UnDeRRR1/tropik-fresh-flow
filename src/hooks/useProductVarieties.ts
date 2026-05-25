import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { normalizeProductKey } from "@/lib/product-aliases";

/**
 * Loads the full variety dictionary once and groups it by Ukrainian product
 * name (lowercased). Use `useVarietiesFor(productName)` to get suggestions
 * for a specific product.
 */
export function useAllProductVarieties() {
  return useQuery({
    queryKey: ["product-varieties"],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const map: Record<string, string[]> = {};
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("product_varieties")
          .select("product_name_ua, product_name_en, variety")
          .order("variety")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        for (const row of data ?? []) {
          const keys = [row.product_name_ua, row.product_name_en].filter(Boolean) as string[];
          for (const k of keys) {
            const key = normalizeProductKey(k);
            if (!key) continue;
            if (!map[key]) map[key] = [];
            if (!map[key].includes(row.variety)) map[key].push(row.variety);
          }
        }
        if (!data || data.length < PAGE) break;
      }
      return map;
    },
  });
}

/**
 * Strip trailing packaging-qualifier token from a UA product name so that
 * variants like "Полуниця (ваг)" / "Черешня (фас)" still resolve to the
 * base product's variety list. Scope: varieties ONLY — do not reuse for
 * pallet_standards / customs_reference / cost / product identity.
 */
function stripPackagingQualifier(name: string): string {
  return name.replace(/\s*\((?:ваг|кош|фас|пучок|зелень|корінь|стебло)\)\s*$/i, "").trim();
}

export function useVarietiesFor(productName: string | null | undefined): string[] {
  const { data } = useAllProductVarieties();
  return useMemo(() => {
    if (!productName || !data) return [];
    // 1) Exact match on the selected product name.
    const exact = data[normalizeProductKey(productName)];
    if (exact && exact.length) return exact;
    // 2) Fallback: strip trailing packaging qualifier and look up the base
    //    product (e.g. "Полуниця (ваг)" → "Полуниця").
    const base = stripPackagingQualifier(productName);
    if (base && base !== productName) {
      const baseHit = data[normalizeProductKey(base)];
      if (baseHit && baseHit.length) return baseHit;
    }
    return [];
  }, [productName, data]);
}

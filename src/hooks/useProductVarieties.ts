import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";

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
            const key = k.toLowerCase();
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

export function useVarietiesFor(productName: string | null | undefined): string[] {
  const { data } = useAllProductVarieties();
  return useMemo(() => {
    if (!productName || !data) return [];
    return data[productName.trim().toLowerCase()] ?? [];
  }, [productName, data]);
}

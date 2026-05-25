import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Loads product aliases from the DB and resolves each alias to the canonical
 * Ukrainian product name (`product_dictionary.product_name_ua`). Keys are
 * lowercased alias forms; values are canonical UA product names.
 *
 * Used to feed AutocompleteCell.aliases so that typing "orange" suggests
 * "Апельсин", "grape" → "Виноград", etc.
 */
export function useProductAliases(): Record<string, string> {
  const { data } = useQuery({
    queryKey: ["product-aliases-map"],
    queryFn: async () => {
      const PAGE = 1000;

      // 1) canonical_product_id → product_name_ua
      const idToName: Record<string, string> = {};
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("product_dictionary")
          .select("canonical_product_id,product_name_ua")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        for (const r of data ?? []) {
          const id = (r.canonical_product_id ?? "") as string;
          const name = (r.product_name_ua ?? "") as string;
          if (id && name && !idToName[id]) idToName[id] = name.trim();
        }
        if (!data || data.length < PAGE) break;
      }

      // 2) alias_normalized → product_name_ua
      const map: Record<string, string> = {};
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("product_aliases")
          .select("alias_normalized,canonical_product_id")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        for (const r of data ?? []) {
          const key = (r.alias_normalized ?? "").toLowerCase();
          const id = (r.canonical_product_id ?? "") as string;
          if (!key || !id) continue;
          const name = idToName[id];
          if (name && !map[key]) map[key] = name;
        }
        if (!data || data.length < PAGE) break;
      }
      return map;
    },
    staleTime: 10 * 60 * 1000,
  });
  return data ?? {};
}

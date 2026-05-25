import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Loads country aliases from the DB (`country_aliases`). Keys are lowercased
 * alias forms; values are canonical Ukrainian country names matching
 * `countries.name`. No hardcoded fallback (Phase 0 cleanup).
 */
export function useCountryAliases(): Record<string, string> {
  const { data } = useQuery({
    queryKey: ["country-aliases"],
    queryFn: async () => {
      const map: Record<string, string> = {};
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("country_aliases")
          .select("alias_normalized,country_name")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        for (const row of data ?? []) {
          const key = (row.alias_normalized ?? "").toLowerCase();
          if (!key) continue;
          if (!map[key]) map[key] = row.country_name as string;
        }
        if (!data || data.length < PAGE) break;
      }
      return map;
    },
    staleTime: 10 * 60 * 1000,
  });
  return data ?? {};
}

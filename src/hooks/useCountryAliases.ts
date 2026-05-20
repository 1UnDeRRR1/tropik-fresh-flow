import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { COUNTRY_ALIASES } from "@/lib/country-search";

/**
 * Loads country aliases from the DB and merges them with the static
 * COUNTRY_ALIASES fallback. Keys are lowercased alias forms (EN names,
 * ISO2/ISO3 codes, multilingual variants); values are canonical Ukrainian
 * country names matching `countries.name`.
 */
export function useCountryAliases(): Record<string, string> {
  const { data } = useQuery({
    queryKey: ["country-aliases"],
    queryFn: async () => {
      const { data } = await supabase
        .from("country_aliases")
        .select("alias_normalized,country_name");
      const map: Record<string, string> = {};
      for (const row of data ?? []) {
        const key = (row.alias_normalized ?? "").toLowerCase();
        if (!key) continue;
        // First write wins; avoid overwriting with an ambiguous later mapping.
        if (!map[key]) map[key] = row.country_name as string;
      }
      return map;
    },
    staleTime: 10 * 60 * 1000,
  });
  return { ...COUNTRY_ALIASES, ...(data ?? {}) };
}

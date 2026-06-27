// Build 2A.9 — create-only: distinct list of country strings present in
// customs_reference. Returned as raw strings (uppercase Ukrainian, with
// idiosyncrasies like "ПАР", "КОСТА-РИКА", "ЕСВАТІНІ (СВАЗІЛЕНД ДО 2018Р)").
// Consumer is responsible for resolving each to the canonical countries.name
// via case-insensitive match + country aliases.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useCustomsCountries(): string[] {
  const { data } = useQuery({
    queryKey: ["customs-countries-distinct"],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const out = new Set<string>();
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("customs_reference")
          .select("country")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        for (const row of data ?? []) {
          const raw = ((row as { country?: string | null }).country ?? "").trim();
          if (raw) out.add(raw);
        }
        if (!data || data.length < PAGE) break;
      }
      return Array.from(out);
    },
  });
  return data ?? [];
}

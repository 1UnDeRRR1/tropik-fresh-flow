import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useCountryOptions() {
  const { data } = useQuery({
    queryKey: ["country-options"],
    queryFn: async () => {
      const { data } = await supabase
        .from("countries")
        .select("name,sort_order,is_active")
        .eq("is_active", true)
        .order("sort_order")
        .order("name");
      return (data ?? []).map((c) => c.name).filter(Boolean) as string[];
    },
    staleTime: 5 * 60 * 1000,
  });
  return data ?? [];
}

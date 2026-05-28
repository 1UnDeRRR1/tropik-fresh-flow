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

/**
 * Generic grade/caliber tokens that historically leaked into the variety
 * dictionary (e.g. "A", "B", "C", "AA", "1", "Extra"). They are never useful
 * as a сорт suggestion — strip them at the display layer (no DB change).
 */
function isGenericGradeToken(v: string): boolean {
  const t = v.trim();
  if (!t) return true;
  // 1–2 char tokens made of letters/digits only (A, B, C, AA, A1, 1, 2…)
  if (t.length <= 2 && /^[A-Za-z0-9]+$/.test(t)) return true;
  // Common grade words
  if (/^(extra|premium|grade|class|клас|сорт)$/i.test(t)) return true;
  return false;
}

export function useVarietiesFor(productName: string | null | undefined): string[] {
  const { data } = useAllProductVarieties();
  return useMemo(() => {
    if (!productName || !data) return [];
    const pick = (arr: string[] | undefined) =>
      (arr ?? []).filter((v) => !isGenericGradeToken(v));
    // 1) Exact match on the selected product name.
    const exact = pick(data[normalizeProductKey(productName)]);
    if (exact.length) return exact;
    // 2) Fallback: strip trailing packaging qualifier and look up the base
    //    product (e.g. "Полуниця (ваг)" → "Полуниця").
    const base = stripPackagingQualifier(productName);
    if (base && base !== productName) {
      const baseHit = pick(data[normalizeProductKey(base)]);
      if (baseHit.length) return baseHit;
    }
    return [];
  }, [productName, data]);
}

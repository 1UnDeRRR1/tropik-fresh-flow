// Phase 0 — DB-backed alias cache replacing legacy hardcoded maps.
//
// Sync getters return a Record<string,string> (lowercased alias → canonical).
// On first access, an async prefetch is fired (idempotent). Consumers fall
// back to identity / title-case behavior when the cache is empty, which is
// the same behavior the legacy hardcoded maps produced for unknown inputs.
// No first-render race, no empty-autocomplete regression, no crash.

import { supabase } from "@/integrations/supabase/client";

let productAliasMap: Record<string, string> = {};
let countryAliasMap: Record<string, string> = {};

let productLoadPromise: Promise<void> | null = null;
let countryLoadPromise: Promise<void> | null = null;

async function loadProductAliases(): Promise<void> {
  try {
    const PAGE = 1000;
    const merged: Record<string, string> = {};
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("product_aliases")
        .select("alias_normalized,canonical_product_id")
        .range(from, from + PAGE - 1);
      if (error) throw error;
      for (const row of data ?? []) {
        const key = (row.alias_normalized ?? "").toLowerCase();
        if (!key) continue;
        const target = (row.canonical_product_id ?? "") as string;
        if (target && !merged[key]) merged[key] = target;
      }
      if (!data || data.length < PAGE) break;
    }
    productAliasMap = merged;
  } catch {
    // Network/permission failure → leave empty; consumers handle missing alias.
  }
}

async function loadCountryAliases(): Promise<void> {
  try {
    const PAGE = 1000;
    const merged: Record<string, string> = {};
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("country_aliases")
        .select("alias_normalized,country_name")
        .range(from, from + PAGE - 1);
      if (error) throw error;
      for (const row of data ?? []) {
        const key = (row.alias_normalized ?? "").toLowerCase();
        if (!key) continue;
        const target = (row.country_name ?? "") as string;
        if (target && !merged[key]) merged[key] = target;
      }
      if (!data || data.length < PAGE) break;
    }
    countryAliasMap = merged;
  } catch {
    // Same fallback policy — empty cache is safe.
  }
}

/** Fire-and-forget prefetch. Idempotent. Call once after auth is ready. */
export function initAliasCache(): void {
  if (!productLoadPromise) productLoadPromise = loadProductAliases();
  if (!countryLoadPromise) countryLoadPromise = loadCountryAliases();
}

/** Sync accessor — may be empty before initAliasCache resolves. */
export function getProductAliases(): Record<string, string> {
  if (!productLoadPromise) productLoadPromise = loadProductAliases();
  return productAliasMap;
}

/** Sync accessor — may be empty before initAliasCache resolves. */
export function getCountryAliases(): Record<string, string> {
  if (!countryLoadPromise) countryLoadPromise = loadCountryAliases();
  return countryAliasMap;
}

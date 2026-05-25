// Phase 0 — DB-backed alias cache replacing legacy hardcoded maps.
//
// Sync getters return a Record<string,string> (lowercased alias → canonical
// name as stored in the working dictionaries). On first access, an async
// prefetch is fired (idempotent). Consumers fall back to identity behavior
// when the cache is empty.
//
// Phase 2 fix: product_aliases.canonical_product_id is a code like
// "OPROD0001". The UI expects canonical product NAME (product_name_ua from
// product_dictionary). We join the two tables client-side so the alias map
// stores `alias_normalized → product_name_ua`, which matches the values
// returned by useProductDictionary queries.

import { supabase } from "@/integrations/supabase/client";

let productAliasMap: Record<string, string> = {};
let countryAliasMap: Record<string, string> = {};

let productLoadPromise: Promise<void> | null = null;
let countryLoadPromise: Promise<void> | null = null;

async function loadProductAliases(): Promise<void> {
  try {
    const PAGE = 1000;

    // 1) Build canonical_product_id → product_name_ua map from dictionary.
    const idToName: Record<string, string> = {};
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("product_dictionary")
        .select("canonical_product_id,product_name_ua,product_name_en")
        .range(from, from + PAGE - 1);
      if (error) throw error;
      for (const row of data ?? []) {
        const id = (row.canonical_product_id ?? "") as string;
        const name = (row.product_name_ua ?? "") as string;
        if (id && name && !idToName[id]) idToName[id] = name.trim();
      }
      if (!data || data.length < PAGE) break;
    }

    // 2) Read aliases and resolve each to the canonical Ukrainian name.
    const merged: Record<string, string> = {};
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("product_aliases")
        .select("alias_normalized,canonical_product_id")
        .range(from, from + PAGE - 1);
      if (error) throw error;
      for (const row of data ?? []) {
        const key = (row.alias_normalized ?? "").toLowerCase();
        const id = (row.canonical_product_id ?? "") as string;
        if (!key || !id) continue;
        const name = idToName[id];
        if (name && !merged[key]) merged[key] = name;
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

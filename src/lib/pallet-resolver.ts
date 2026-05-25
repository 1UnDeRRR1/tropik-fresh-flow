// Unified pallet autofill helper.
//
// Single source of truth used by BOTH the dropdown (via usePalletResolver)
// AND autofill call sites (DraftOfferLineRow, shipments/$id.products.tsx).
// All pallet values come from `rpc_pallet_standard_resolve`. Tier order:
// exact → compound_group → all_fallback → no_match. Europe/Overseas regional
// tier is deferred (no continent map). Product text is resolved to a
// `product_dictionary.id` via exact UA name then alias_normalized.

import { supabase } from "@/integrations/supabase/client";

export type PalletMatchType =
  | "exact"
  | "compound_group"
  | "all_fallback"
  | "no_match";

export type PalletOption = {
  package_used: string;
  pallet_size: string | null;
  pallet_net_kg: number | null;
  pallet_gross_kg: number | null;
};

export type PalletResolveResult = {
  dictionaryId: string | null;
  productNameUa: string | null;
  matchType: PalletMatchType;
  isFallback: boolean;
  fallbackExplanation: string | null;
  options: PalletOption[];
  selected: PalletOption | null;
};

const EMPTY: PalletResolveResult = {
  dictionaryId: null,
  productNameUa: null,
  matchType: "no_match",
  isFallback: false,
  fallbackExplanation: null,
  options: [],
  selected: null,
};

function pickHeaviest(opts: PalletOption[]): PalletOption | null {
  if (!opts.length) return null;
  return [...opts].sort(
    (a, b) => (b.pallet_gross_kg ?? -1) - (a.pallet_gross_kg ?? -1),
  )[0];
}

/**
 * Resolve product text → product_dictionary row.
 * 1) exact UA name (case-insensitive)
 * 2) alias_normalized fallback
 */
async function resolveDictionaryId(
  productText: string,
): Promise<{ id: string; name: string } | null> {
  const product = productText.trim();
  if (!product) return null;

  const { data: byName } = await supabase
    .from("product_dictionary")
    .select("id,product_name_ua")
    .ilike("product_name_ua", product)
    .limit(1);
  const direct = byName?.[0];
  if (direct?.id) {
    return {
      id: direct.id as string,
      name: (direct.product_name_ua as string) ?? product,
    };
  }

  const { data: alias } = await supabase
    .from("product_aliases")
    .select("canonical_product_id")
    .eq("alias_normalized", product.toLowerCase())
    .limit(1);
  const cpid = alias?.[0]?.canonical_product_id as string | undefined;
  if (!cpid) return null;

  const { data: dict } = await supabase
    .from("product_dictionary")
    .select("id,product_name_ua")
    .eq("canonical_product_id", cpid)
    .limit(1);
  const row = dict?.[0];
  if (!row?.id) return null;
  return {
    id: row.id as string,
    name: (row.product_name_ua as string) ?? product,
  };
}

/**
 * Resolve pallet/packaging for free-text product+country input.
 * Returns options list + heaviest-gross selection + match metadata.
 *
 * Same RPC the dropdown uses, so autofill and dropdown always agree.
 */
export async function resolvePalletForText(
  productText: string,
  countryText: string,
): Promise<PalletResolveResult> {
  const product = (productText ?? "").trim();
  const country = (countryText ?? "").trim();
  if (!product) return EMPTY;

  const dict = await resolveDictionaryId(product);
  if (!dict) return EMPTY;

  const { data, error } = await supabase.rpc(
    "rpc_pallet_standard_resolve" as never,
    { p_dictionary_id: dict.id, p_country: country || null } as never,
  );
  if (error) {
    return { ...EMPTY, dictionaryId: dict.id, productNameUa: dict.name };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        options: unknown;
        match_type: string | null;
        is_fallback: boolean | null;
        fallback_explanation: string | null;
      }
    | null
    | undefined;
  if (!row) return { ...EMPTY, dictionaryId: dict.id, productNameUa: dict.name };

  const raw = (row.options ?? []) as Array<{
    package_used: string | null;
    pallet_size: string | null;
    pallet_net_kg: number | string | null;
    pallet_gross_kg: number | string | null;
  }>;
  const options: PalletOption[] = raw
    .filter((o) => !!o?.package_used)
    .map((o) => ({
      package_used: String(o.package_used),
      pallet_size: o.pallet_size ?? null,
      pallet_net_kg: o.pallet_net_kg == null ? null : Number(o.pallet_net_kg),
      pallet_gross_kg:
        o.pallet_gross_kg == null ? null : Number(o.pallet_gross_kg),
    }));

  return {
    dictionaryId: dict.id,
    productNameUa: dict.name,
    matchType: (row.match_type ?? "no_match") as PalletMatchType,
    isFallback: !!row.is_fallback,
    fallbackExplanation: (row.fallback_explanation ?? null) as string | null,
    options,
    selected: pickHeaviest(options),
  };
}

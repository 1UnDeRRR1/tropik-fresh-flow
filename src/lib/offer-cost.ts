// Live cost calculation for Import Manager Offers.
// Mirrors the shipment-side logic in calc_shipment_item_costs():
//   - Convert price/freight from EUR→USD using the latest exchange rate snapshot.
//   - Look up customs_reference by product+country.
//   - Indicative duty = euro1_markup_usd (if a reference matched).
//   - If unit_price_usd ≤ threshold: invoice duty = euro1_markup_usd.
//   - Else: invoice duty = unit*1.20*pct/100 + unit*0.20 + 0.02
//          (pct = euro1_percent for EU countries, customs_fee_percent otherwise).
//   - transport_per_kg = (freight_usd / expected_pallets) / pallet_weight,
//     expected_pallets = min(26, floor(21500 / pallet_weight)).
//   - indicative_cost = unit_usd + transport_per_kg + indicative_duty
//   - invoice_cost    = unit_usd + transport_per_kg + invoice_duty

import { supabase } from "@/integrations/supabase/client";
import { getCountryAliasTargets } from "@/lib/alias-cache";

const EU_COUNTRIES_UPPER = new Set([
  "АВСТРІЯ","БЕЛЬГІЯ","БОЛГАРІЯ","ХОРВАТІЯ","КІПР","ЧЕХІЯ","ДАНІЯ",
  "ЕСТОНІЯ","ФІНЛЯНДІЯ","ФРАНЦІЯ","НІМЕЧЧИНА","ГРЕЦІЯ","УГОРЩИНА",
  "ІРЛАНДІЯ","ІТАЛІЯ","ЛАТВІЯ","ЛИТВА","ЛЮКСЕМБУРГ","МАЛЬТА",
  "НІДЕРЛАНДИ","ПОЛЬЩА","ПОРТУГАЛІЯ","РУМУНІЯ","СЛОВАЧЧИНА",
  "СЛОВЕНІЯ","ІСПАНІЯ","ШВЕЦІЯ",
]);

export function isEuCountry(c: string | null | undefined) {
  return EU_COUNTRIES_UPPER.has((c ?? "").trim().toUpperCase());
}

export type CustomsRefRow = {
  id: string;
  threshold_price_usd: number;
  customs_fee_percent: number;
  euro1_percent: number;
  euro1_markup_usd: number;
  product_name?: string;
  country?: string;
  /** True only when an exact product+country row matched. Fallback (same
   * product, any country) sets this to false so the UI can still show
   * "не знайдено" while the calculation uses the highest indicative. */
  exact?: boolean;
};

/** Patch 6B: GREEN/YELLOW/RED status from a customs lookup result. */
export function getCustomsStatus(
  ref: CustomsRefRow | null | undefined,
): "green" | "yellow" | "red" {
  if (!ref) return "red";
  return ref.exact === true ? "green" : "yellow";
}

// Product aliases for customs lookup: treat key as if it were value
const PRODUCT_CUSTOMS_ALIASES: Record<string, string> = {
  "інжирний персик": "персик",
  "платерина нектарин": "нектарин",
};

function resolveCustomsProductName(name: string): string {
  const key = name.trim().toLowerCase();
  return PRODUCT_CUSTOMS_ALIASES[key] ?? name;
}

export async function fetchCustomsRef(productName: string, country: string): Promise<CustomsRefRow | null> {
  const name = resolveCustomsProductName(productName.trim());
  if (!name) return null;
  // 1) exact product + country match. Expand country to all alias forms so
  //    customs_reference rows stored under any alias (e.g. "ПАР" for canonical
  //    "Південна Африка") are matched. Uses cached reverse alias index — no
  //    extra network call.
  const trimmedCountry = country.trim();
  if (trimmedCountry) {
    const candidates = getCountryAliasTargets(trimmedCountry);
    const list = candidates.length > 0 ? candidates : [trimmedCountry];
    // Case-insensitive country match: customs_reference rows are stored in
    // UPPERCASE (e.g. "ЧИЛІ") while countries.name is mixed case ("Чилі").
    // Using `.in()` would miss every row. Build an OR of ilike per candidate.
    const orExpr = list
      .map((c) => `country.ilike.${c.replace(/,/g, "")}`)
      .join(",");
    const { data } = await supabase
      .from("customs_reference")
      .select("id,product_name,country,threshold_price_usd,customs_fee_percent,euro1_percent,euro1_markup_usd")
      .eq("active", true)
      .ilike("product_name", name)
      .or(orExpr)
      .order("threshold_price_usd", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return { ...(data as CustomsRefRow), exact: true };
  }
  // 2) fallback: same product, any country — pick row with highest indicative
  const { data: fb } = await supabase
    .from("customs_reference")
    .select("id,product_name,country,threshold_price_usd,customs_fee_percent,euro1_percent,euro1_markup_usd")
    .eq("active", true)
    .ilike("product_name", name)
    .order("euro1_markup_usd", { ascending: false, nullsFirst: false })
    .order("threshold_price_usd", { ascending: false })
    .limit(1)
    .maybeSingle();
  return fb ? { ...(fb as CustomsRefRow), exact: false } : null;
}

export type OfferCostInput = {
  pricePerKg: number;
  priceCurrency: "EUR" | "USD";
  freight: number;
  freightCurrency: "EUR" | "USD";
  palletWeight: number;
  fxRate: number | null;
  country: string;
  ref: CustomsRefRow | null;
};

export type OfferCostResult = {
  unitUsd: number;
  freightUsd: number;
  expectedPallets: number;
  freightPerPallet: number;
  transportPerKg: number;
  indicativeDuty: number;
  invoiceDuty: number;
  indicativeCost: number;
  invoiceCost: number;
};

export function computeOfferCost(input: OfferCostInput): OfferCostResult {
  const fx = Number(input.fxRate ?? 0);
  const unitUsd = input.priceCurrency === "USD"
    ? Number(input.pricePerKg || 0)
    : Number(input.pricePerKg || 0) * fx;
  const freightUsd = input.freightCurrency === "USD"
    ? Number(input.freight || 0)
    : Number(input.freight || 0) * fx;

  const pw = Number(input.palletWeight || 0);
  let expectedPallets = 26;
  if (pw > 0) {
    expectedPallets = Math.min(26, Math.floor(21500 / pw));
    if (expectedPallets < 1) expectedPallets = 1;
  }
  const freightPerPallet = expectedPallets > 0 ? freightUsd / expectedPallets : 0;
  const transportPerKg = pw > 0 ? freightPerPallet / pw : 0;

  let indicativeDuty = 0;
  let invoiceDuty = 0;
  if (input.ref) {
    indicativeDuty = Number(input.ref.euro1_markup_usd || 0);
    if (unitUsd <= Number(input.ref.threshold_price_usd || 0)) {
      invoiceDuty = Number(input.ref.euro1_markup_usd || 0);
    } else {
      const pct = isEuCountry(input.country)
        ? Number(input.ref.euro1_percent || 0)
        : Number(input.ref.customs_fee_percent || 0);
      invoiceDuty = unitUsd * 1.20 * pct / 100 + unitUsd * 0.20 + 0.02;
    }
  }

  return {
    unitUsd,
    freightUsd,
    expectedPallets,
    freightPerPallet,
    transportPerKg,
    indicativeDuty,
    invoiceDuty,
    indicativeCost: unitUsd + transportPerKg + indicativeDuty,
    invoiceCost: unitUsd + transportPerKg + invoiceDuty,
  };
}

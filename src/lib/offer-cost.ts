// Live cost calculation for Import Manager Offers.
// Uses split Net/Gross per pallet:
//   - gross controls vehicle capacity:
//       expected_pallets = min(26, floor(21500 / gross_per_pallet))
//   - net is the transport $/kg denominator:
//       transport_per_kg = (freight_usd / expected_pallets) / net_per_pallet
//   - indicative_cost = unit_usd + transport_per_kg + indicative_duty
//   - invoice_cost    = unit_usd + transport_per_kg + invoice_duty
//
// Fallback policy: NO FX=0, NO customs=0, NO pallet_weight fallback. If a
// required input is missing the result is `null` and the caller must surface
// the targeted Stage B / Stage C manual fields.

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
  exact?: boolean;
};

export function getCustomsStatus(
  ref: CustomsRefRow | null | undefined,
): "green" | "yellow" | "red" {
  if (!ref) return "red";
  return ref.exact === true ? "green" : "yellow";
}

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
  const trimmedCountry = country.trim();
  if (trimmedCountry) {
    const candidates = getCountryAliasTargets(trimmedCountry);
    const list = candidates.length > 0 ? candidates : [trimmedCountry];
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
  /** Net weight per pallet (kg). Transport $/kg denominator. */
  netPerPalletKg: number;
  /** Gross weight per pallet (kg). Vehicle-capacity driver. */
  grossPerPalletKg: number;
  fxRate: number | null;
  country: string;
  ref: CustomsRefRow | null;
  /**
   * Optional confirmed/local manual customs duty (USD/kg). When present and
   * positive, short-circuits both indicative AND invoice duty regardless of
   * customs reference availability.
   */
  manualCustomsDuty?: number | null;
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

/**
 * Resolution state exposed to UI so it can decide whether to surface Stage B
 * (manual FX / manual customs) or Stage C (final manual cost pair) fields.
 */
export type OfferCostResolution = {
  /** EUR/USD rate is needed (any EUR input) but no positive finite FX provided. */
  needsFx: boolean;
  /** Customs reference unavailable and no manual override provided. */
  needsCustoms: boolean;
  /** Net/Gross pair is missing or invalid. */
  needsNetGross: boolean;
  /** Stage A/B produced a finite positive (indicative, invoice) pair. */
  ok: boolean;
  /** Computed result when ok=true. */
  result: OfferCostResult | null;
};

const VEHICLE_MAX_PALLETS = 26;
const VEHICLE_MAX_KG = 21500;

/**
 * Pure auto-calculation. Returns the cost result when every input that is
 * truly required for the inputs given is valid; otherwise returns null.
 * Use {@link resolveOfferCost} for a state object suitable for staged UIs.
 */
export function computeOfferCost(input: OfferCostInput): OfferCostResult | null {
  const r = resolveOfferCost(input);
  return r.ok ? r.result : null;
}

export function resolveOfferCost(input: OfferCostInput): OfferCostResolution {
  const net = Number(input.netPerPalletKg);
  const gross = Number(input.grossPerPalletKg);
  const needsNetGross =
    !Number.isFinite(net) || !Number.isFinite(gross) || !(net > 0) || !(gross > net);

  const eurInPrice = input.priceCurrency === "EUR";
  const eurInFreight = input.freightCurrency === "EUR";
  const fx = Number(input.fxRate ?? 0);
  const fxValid = Number.isFinite(fx) && fx > 0;
  const needsFx = (eurInPrice || eurInFreight) && !fxValid;

  const manualDuty =
    input.manualCustomsDuty != null && Number.isFinite(Number(input.manualCustomsDuty))
      ? Number(input.manualCustomsDuty)
      : 0;
  const hasManualDuty = manualDuty > 0;
  const needsCustoms = !hasManualDuty && !input.ref;

  if (needsNetGross || needsFx || needsCustoms) {
    return { needsFx, needsCustoms, needsNetGross, ok: false, result: null };
  }

  const unitUsd =
    input.priceCurrency === "USD"
      ? Number(input.pricePerKg || 0)
      : Number(input.pricePerKg || 0) * fx;
  const freightUsd =
    input.freightCurrency === "USD"
      ? Number(input.freight || 0)
      : Number(input.freight || 0) * fx;

  let expectedPallets = Math.min(
    VEHICLE_MAX_PALLETS,
    Math.floor(VEHICLE_MAX_KG / gross),
  );
  if (expectedPallets < 1) expectedPallets = 1;
  const freightPerPallet = expectedPallets > 0 ? freightUsd / expectedPallets : 0;
  const transportPerKg = net > 0 ? freightPerPallet / net : 0;

  let indicativeDuty = 0;
  let invoiceDuty = 0;
  if (hasManualDuty) {
    indicativeDuty = manualDuty;
    invoiceDuty = manualDuty;
  } else if (input.ref) {
    indicativeDuty = Number(input.ref.euro1_markup_usd || 0);
    if (unitUsd <= Number(input.ref.threshold_price_usd || 0)) {
      invoiceDuty = Number(input.ref.euro1_markup_usd || 0);
    } else {
      const pct = isEuCountry(input.country)
        ? Number(input.ref.euro1_percent || 0)
        : Number(input.ref.customs_fee_percent || 0);
      invoiceDuty = unitUsd * 1.2 * pct / 100 + unitUsd * 0.2 + 0.02;
    }
  }

  const indicativeCost = unitUsd + transportPerKg + indicativeDuty;
  const invoiceCost = unitUsd + transportPerKg + invoiceDuty;

  const ok =
    Number.isFinite(indicativeCost) &&
    Number.isFinite(invoiceCost) &&
    indicativeCost > 0 &&
    invoiceCost > 0;

  return {
    needsFx: false,
    needsCustoms: false,
    needsNetGross: false,
    ok,
    result: ok
      ? {
          unitUsd,
          freightUsd,
          expectedPallets,
          freightPerPallet,
          transportPerKg,
          indicativeDuty,
          invoiceDuty,
          indicativeCost,
          invoiceCost,
        }
      : null,
  };
}

// Pure shipment-row engine.
// Build A — mechanical extraction from
// src/routes/_authenticated/shipments/$id.products.tsx.
// No React, no hooks, no Supabase, no fetch. Formulas and behavior are
// preserved verbatim from the committed editor at the time of extraction.

import { getCountryAliasTargets } from "@/lib/alias-cache";
import {
  canonicalizeProductName,
  normalizeProductKey,
  resolveProductOption,
} from "@/lib/product-aliases";
import { normalizeCountry } from "@/lib/countries";

// -----------------------------------------------------------------------------
// Structural row/context types. The route's concrete ItemRow / ShipmentRow /
// VehicleContext are supersets of these and remain assignable.
// -----------------------------------------------------------------------------

export type ItemRowLike = {
  id: string;
  product_name: string | null;
  variety: string | null;
  origin_country: string | null;
  caliber: string | null;
  sku: string | null;
  pallet_count: number | null;
  pallet_weight: number | null;
  unit_price: number | null;
  price_currency: string | null;
  customs_override_duty_usd: number | null;
  customs_override_confirmed_at: string | null;
  package_used: string | null;
  net_weight_kg: number | null;
  gross_weight_kg: number | null;
  resolver_net_per_pallet_kg: number | null;
  resolver_gross_per_pallet_kg: number | null;
  net_auto: boolean | null;
  gross_auto: boolean | null;
  // R1A — optional brand/class plumbing. Editor SELECT may or may not include
  // these columns; persistence helpers below treat them as optional inputs.
  brand?: string | null;
  class?: string | null;
};

export type ShipmentRowLike = {
  eur_usd_rate: number | null;
  vehicle_id: string | null;
  logistics_cost_usd: number | null;
};

export type VehicleContextLike = {
  vehicle: { total_pallets: number | null };
  vehicleStatus: string | null;
  shipments: Array<{ id: string; logistics_cost_usd: number | null }>;
};

// -----------------------------------------------------------------------------
// Product / required fields (verbatim from $id.products.tsx L568-L587).
// -----------------------------------------------------------------------------

export type ProductRef = { name: string };

export type RequiredField =
  | "product_name"
  | "origin_country"
  | "pallet_count"
  | "total_weight"
  | "unit_price";

function normalizeProductValue(value: string | null | undefined) {
  return normalizeProductKey(value);
}

export function isKnownProductName(
  value: string | null | undefined,
  products: ProductRef[],
) {
  const normalized = normalizeProductValue(canonicalizeProductName(value));
  if (!normalized) return false;
  if (products.some((product) => normalizeProductValue(product.name) === normalized)) return true;
  // Accept unique prefix match (e.g. "ків" → "Ківі")
  const resolved = resolveProductOption(value, products.map((p) => p.name));
  return !!resolved;
}

// -----------------------------------------------------------------------------
// DraftRow contract (verbatim from $id.products.tsx L106-L128).
// -----------------------------------------------------------------------------

export type DraftRow = {
  localId: string;          // "tmp_<uuid>" for new rows; dbId for existing rows
  dbId: string | null;      // null = new row not yet inserted
  source_offer_id?: string | null;
  source_position_id?: string | null;
  source_offer_freight_amount?: number | null;
  source_offer_freight_currency?: string | null;
  product_name: string;
  variety: string;
  origin_country: string;
  caliber: string;
  sku: string;
  package_used: string;
  pallet_count: number;
  net_weight_kg: number;
  gross_weight_kg: number;
  resolver_net_per_pallet_kg: number | null;
  resolver_gross_per_pallet_kg: number | null;
  net_auto: boolean;
  gross_auto: boolean;
  unit_price: number;
  price_currency: "EUR" | "USD";
  // Build B — optional, additive. $id.products.tsx never sets these, so its
  // dirty-detection and payload behavior are unchanged. /shipments/new wires
  // these to live inputs and spreads them into the INSERT payload.
  brand?: string;
  class?: string;
  // Build 2A.4 — local-only fields on /shipments/new card. Not in
  // DRAFT_EDITABLE_KEYS, not persisted anywhere yet. $id.products.tsx leaves
  // them undefined; commit payload in Build 2B will decide DB destination.
  boxes_per_pallet?: number | null;
  pallet_weight_override_kg?: number | null;
  // Build — manual customs duty (USD/kg) entered when customs reference is
  // not found (RED status). Local-only on /shipments/new; future
  // Create-orchestrator will persist into shipment_items.customs_override_duty_usd.
  customs_override_duty_usd?: number | null;
};


export const DRAFT_EDITABLE_KEYS: (keyof DraftRow)[] = [
  "product_name","variety","origin_country","caliber","sku","package_used",
  "pallet_count","net_weight_kg","gross_weight_kg",
  "resolver_net_per_pallet_kg","resolver_gross_per_pallet_kg",
  "net_auto","gross_auto","unit_price","price_currency",
  "brand","class",
];

export function itemRowToDraft(item: ItemRowLike): DraftRow {
  return {
    localId: item.id,
    dbId: item.id,
    source_offer_id: null,
    source_position_id: null,
    source_offer_freight_amount: null,
    source_offer_freight_currency: null,
    product_name: item.product_name === "Новий товар" ? "" : (item.product_name ?? ""),
    variety: item.variety ?? "",
    origin_country: item.origin_country ?? "",
    caliber: item.caliber ?? "",
    sku: item.sku ?? "",
    package_used: item.package_used ?? "",
    pallet_count: Number(item.pallet_count ?? 0),
    net_weight_kg: Number(item.net_weight_kg ?? 0),
    gross_weight_kg: Number(item.gross_weight_kg ?? 0),
    resolver_net_per_pallet_kg: item.resolver_net_per_pallet_kg ?? null,
    resolver_gross_per_pallet_kg: item.resolver_gross_per_pallet_kg ?? null,
    net_auto: item.net_auto ?? false,
    gross_auto: item.gross_auto ?? false,
    unit_price: Number(item.unit_price ?? 0),
    price_currency: ((item.price_currency ?? "EUR") as "EUR" | "USD"),
    brand: item.brand ?? "",
    class: item.class ?? "",
  };
}

export function emptyDraftRow(): DraftRow {
  const uuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    localId: `tmp_${uuid}`,
    dbId: null,
    source_offer_id: null,
    source_position_id: null,
    source_offer_freight_amount: null,
    source_offer_freight_currency: null,
    product_name: "",
    variety: "",
    origin_country: "",
    caliber: "",
    sku: "",
    package_used: "",
    pallet_count: 0,
    net_weight_kg: 0,
    gross_weight_kg: 0,
    resolver_net_per_pallet_kg: null,
    resolver_gross_per_pallet_kg: null,
    net_auto: false,
    gross_auto: false,
    unit_price: 0,
    price_currency: "EUR",
    brand: "",
    class: "",
  };
}

export function isDraftDirty(a: DraftRow, b: DraftRow): boolean {
  for (const k of DRAFT_EDITABLE_KEYS) {
    const av = a[k];
    const bv = b[k];
    if (typeof av === "number" && typeof bv === "number") {
      if (Math.abs(av - bv) > 1e-9) return true;
    } else if (av !== bv) {
      return true;
    }
  }
  return false;
}

export function getMissingDraftFields(d: DraftRow, products: ProductRef[]): RequiredField[] {
  const missing: RequiredField[] = [];
  if (!d.product_name.trim() || !isKnownProductName(d.product_name, products)) missing.push("product_name");
  if (!d.origin_country.trim()) missing.push("origin_country");
  if (d.pallet_count <= 0) missing.push("pallet_count");
  if (d.net_weight_kg <= 0 || d.gross_weight_kg <= 0) missing.push("total_weight");
  if (!d.unit_price || d.unit_price <= 0) missing.push("unit_price");
  return missing;
}

// -----------------------------------------------------------------------------
// Customs helpers (verbatim from $id.products.tsx L246-L331).
// -----------------------------------------------------------------------------

// D1-Fix v2.4 — local DB-mirroring customs preview helpers.
// EU list copies public.is_eu_country verbatim (27 entries, Cyrillic).
const EU_COUNTRIES = new Set<string>([
  "АВСТРІЯ","БЕЛЬГІЯ","БОЛГАРІЯ","ХОРВАТІЯ","КІПР","ЧЕХІЯ","ДАНІЯ",
  "ЕСТОНІЯ","ФІНЛЯНДІЯ","ФРАНЦІЯ","НІМЕЧЧИНА","ГРЕЦІЯ","УГОРЩИНА",
  "ІРЛАНДІЯ","ІТАЛІЯ","ЛАТВІЯ","ЛИТВА","ЛЮКСЕМБУРГ","МАЛЬТА",
  "НІДЕРЛАНДИ","ПОЛЬЩА","ПОРТУГАЛІЯ","РУМУНІЯ","СЛОВАЧЧИНА",
  "СЛОВЕНІЯ","ІСПАНІЯ","ШВЕЦІЯ",
]);
export function isEuCountry(c: string | null | undefined): boolean {
  return EU_COUNTRIES.has((c ?? "").trim().toUpperCase());
}
export function normalizeCustomsKey(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}
export function customsLookupName(productName: string | null | undefined): string {
  const k = normalizeCustomsKey(productName);
  // Mirror DB CASE in calc_shipment_item_costs (hardcoded aliases only).
  if (k === "інжирний персик") return "персик";
  if (k === "платерина нектарин") return "нектарин";
  return (productName ?? "").trim();
}

export type ActiveCustomsRef = {
  id: string;
  product_name: string;
  country: string;
  threshold_price_usd: number | null;
  customs_fee_percent: number | null;
  euro1_markup_usd: number | null;
  euro1_percent: number | null;
};

export function getCountryCandidatesNormalized(originCountry: string): Set<string> {
  // Expand canonical country into all alias forms (e.g. "Південна Африка"
  // → ["Південна Африка", "ПАР", …]) so customs_reference rows stored under
  // any alias form are matched. Falls back to the raw input when alias cache
  // is empty.
  const raw = (originCountry ?? "").trim();
  if (!raw) return new Set();
  const targets = getCountryAliasTargets(raw);
  const list = targets.length > 0 ? targets : [raw];
  return new Set(list.map((c) => normalizeCustomsKey(c)));
}

export function pickCustomsRefForDraft(
  productName: string,
  originCountry: string,
  refs: ActiveCustomsRef[],
): ActiveCustomsRef | null {
  const lookup = normalizeCustomsKey(customsLookupName(productName));
  if (!lookup) return null;
  const candidates = getCountryCandidatesNormalized(originCountry);
  // Exact product + country (alias-expanded), ORDER BY threshold_price_usd DESC
  const exact = refs
    .filter((r) => normalizeCustomsKey(r.product_name) === lookup
                && candidates.has(normalizeCustomsKey(r.country)))
    .sort((a, b) => Number(b.threshold_price_usd ?? 0) - Number(a.threshold_price_usd ?? 0));
  if (exact.length > 0) return exact[0];
  // Fallback product-only, ORDER BY euro1_markup_usd DESC NULLS LAST, threshold_price_usd DESC
  const fb = refs
    .filter((r) => normalizeCustomsKey(r.product_name) === lookup)
    .sort((a, b) => {
      const ae = a.euro1_markup_usd;
      const be = b.euro1_markup_usd;
      if (ae == null && be != null) return 1;
      if (be == null && ae != null) return -1;
      if (ae != null && be != null && Number(ae) !== Number(be)) return Number(be) - Number(ae);
      return Number(b.threshold_price_usd ?? 0) - Number(a.threshold_price_usd ?? 0);
    });
  return fb[0] ?? null;
}

export function computeCustomsPreview(
  unitUsd: number,
  ref: ActiveCustomsRef | null,
  overrideDuty: number | null,
): { indicative: number; invoice: number } {
  // Confirmed override mirrors DB short-circuit (no EU branch).
  if (overrideDuty != null) return { indicative: overrideDuty, invoice: overrideDuty };
  if (!ref) return { indicative: 0, invoice: 0 };
  const indicative = Number(ref.euro1_markup_usd ?? 0);
  const threshold = Number(ref.threshold_price_usd ?? 0);
  if (unitUsd <= threshold) return { indicative, invoice: indicative };
  // EU decision uses ref.country, NOT draft.origin_country.
  const isEu = isEuCountry(ref.country);
  const pct = isEu ? Number(ref.euro1_percent ?? 0) : Number(ref.customs_fee_percent ?? 0);
  const invoice = (unitUsd * 1.20 * pct / 100) + (unitUsd * 0.20) + 0.02;
  return { indicative, invoice };
}

// -----------------------------------------------------------------------------
// Row preview (verbatim from $id.products.tsx L333-L513).
// -----------------------------------------------------------------------------

// D1-Fix v2.5.3 — row breakdown components (ready values only, no formulas).
export type RowComponents = {
  productName: string;
  country: string;
  inputPrice: number | null;
  inputCurrency: "EUR" | "USD" | null;
  fxRate: number | null;          // only when input currency is EUR
  unitUsd: number | null;
  transportPerKg: number | null;
  customsIndicative: number | null;
  customsInvoice: number | null;
  customsBasis: "exact" | "fallback" | "none" | "manual";
  matchedRef: {
    product_name: string;
    country: string;
    threshold_price_usd: number | null;
    customs_fee_percent: number | null;
    euro1_markup_usd: number | null;
    euro1_percent: number | null;
  } | null;
};

// D1-Fix v2.5.3 — single helper returning both final preview value AND component values.
// Clean-row safety: when isClean, customs ref comes ONLY from savedRefForClean
// (the saved customs_match_id row from refById). pickCustomsRefForDraft is NEVER
// called for clean rows, and active-flag filtering can't drop a saved match.
// Live mode (dirty/new draft rows) keeps the existing pickCustomsRefForDraft logic.
export function computeRowPreview(
  d: DraftRow,
  dbItem: ItemRowLike | null,
  sh: ShipmentRowLike | null,
  vehicleContext: VehicleContextLike | null,
  refs: ActiveCustomsRef[] | null,
  latestEurUsd: number | null,
  products: ProductRef[],
  isClean: boolean,
  savedRefForClean: ActiveCustomsRef | null,
  // Build B — additive. Local manual customs override held only in the
  // /shipments/new draft state, before any INSERT exists. Honored exactly like
  // a saved dbItem override (mirrors DB short-circuit; sets basis="manual";
  // wins over any picked ref) ONLY when the confirmed identity snapshot
  // (product_name + origin_country, normalized) matches the current draft AND
  // duty_usd > 0 AND confirmed_at is present. A stale override from a previous
  // product/country combination must never survive an identity change.
  // All existing call sites omit this argument and get the previous behavior.
  localOverride: {
    duty_usd: number;
    confirmed_at: string;
    by: string | null;
    product_name: string;
    origin_country: string;
  } | null = null,
): { value: { indicative: number; invoice: number } | null; components: RowComponents } {
  const components: RowComponents = {
    productName: d.product_name,
    country: d.origin_country,
    inputPrice: d.unit_price > 0 ? d.unit_price : null,
    inputCurrency: d.price_currency,
    fxRate: null,
    unitUsd: null,
    transportPerKg: null,
    customsIndicative: null,
    customsInvoice: null,
    customsBasis: "none",
    matchedRef: null,
  };

  // Unit USD (always derive when possible, even if other fields missing).
  let unitUsd: number | null = null;
  if (d.unit_price > 0) {
    if (d.price_currency === "USD") {
      unitUsd = d.unit_price;
    } else {
      const fx = (sh?.eur_usd_rate ?? latestEurUsd) ?? null;
      if (fx && fx > 0) {
        components.fxRate = fx;
        unitUsd = d.unit_price * fx;
      }
    }
  }
  components.unitUsd = unitUsd;

  // Customs ref selection.
  let ref: ActiveCustomsRef | null = null;
  if (isClean) {
    // Clean row: use ONLY the saved customs_match_id row, never re-pick.
    ref = savedRefForClean;
    if (ref) {
      const cand = getCountryCandidatesNormalized(d.origin_country);
      const sameCountry = cand.has(normalizeCustomsKey(ref.country));
      components.matchedRef = {
        product_name: ref.product_name,
        country: ref.country,
        threshold_price_usd: ref.threshold_price_usd,
        customs_fee_percent: ref.customs_fee_percent,
        euro1_markup_usd: ref.euro1_markup_usd,
        euro1_percent: ref.euro1_percent,
      };
      components.customsBasis = sameCountry ? "exact" : "fallback";
    } else {
      components.customsBasis = "none";
    }
  } else if (refs && d.product_name.trim() && d.origin_country.trim()) {
    ref = pickCustomsRefForDraft(d.product_name, d.origin_country, refs);
    if (ref) {
      const cand = getCountryCandidatesNormalized(d.origin_country);
      const sameCountry = cand.has(normalizeCustomsKey(ref.country));
      components.matchedRef = {
        product_name: ref.product_name,
        country: ref.country,
        threshold_price_usd: ref.threshold_price_usd,
        customs_fee_percent: ref.customs_fee_percent,
        euro1_markup_usd: ref.euro1_markup_usd,
        euro1_percent: ref.euro1_percent,
      };
      components.customsBasis = sameCountry ? "exact" : "fallback";
    } else {
      components.customsBasis = "none";
    }
  }

  // Confirmed manual override (only when product+country unchanged vs DB row).
  // Build B — also honor localOverride (drafts not yet inserted on /shipments/new).
  // dbItem wins if both happen to be set (existing-editor invariant unchanged).
  let overrideDuty: number | null = null;
  if (
    dbItem &&
    dbItem.customs_override_confirmed_at &&
    dbItem.customs_override_duty_usd != null &&
    (dbItem.product_name ?? "").trim() === d.product_name.trim() &&
    (dbItem.origin_country ?? "").trim() === d.origin_country.trim()
  ) {
    overrideDuty = Number(dbItem.customs_override_duty_usd);
    components.customsBasis = "manual";
    components.matchedRef = null;
  } else if (
    localOverride &&
    localOverride.confirmed_at &&
    localOverride.duty_usd != null &&
    Number(localOverride.duty_usd) > 0 &&
    normalizeProductValue(canonicalizeProductName(localOverride.product_name)) ===
      normalizeProductValue(canonicalizeProductName(d.product_name)) &&
    normalizeCustomsKey(normalizeCountry(localOverride.origin_country)) ===
      normalizeCustomsKey(normalizeCountry(d.origin_country))
  ) {
    overrideDuty = Number(localOverride.duty_usd);
    components.customsBasis = "manual";
    components.matchedRef = null;
  }

  // Customs preview ($/kg). When unitUsd known we use full helper; otherwise
  // override may still produce values without unitUsd.
  if (unitUsd != null) {
    const c = computeCustomsPreview(unitUsd, ref, overrideDuty);
    components.customsIndicative = c.indicative;
    components.customsInvoice = c.invoice;
  } else if (overrideDuty != null) {
    components.customsIndicative = overrideDuty;
    components.customsInvoice = overrideDuty;
  }

  // Transport per kg — only when shipment context known.
  if (sh) {
    let vehicleLogUsd = 0;
    if (!sh.vehicle_id) {
      vehicleLogUsd = Number(sh.logistics_cost_usd ?? 0);
    } else {
      vehicleLogUsd = (vehicleContext?.shipments ?? []).reduce(
        (acc, row) => acc + Number(row.logistics_cost_usd ?? 0),
        0,
      );
    }
    const pc = d.pallet_count;
    const palletLegacy = Number(dbItem?.pallet_weight ?? 0);
    const netPerPallet =
      pc > 0 && d.net_weight_kg > 0 ? d.net_weight_kg / pc : palletLegacy;
    const grossPerPallet =
      pc > 0 && d.gross_weight_kg > 0 ? d.gross_weight_kg / pc : palletLegacy;
    let expectedPallets: number;
    if (vehicleContext?.vehicleStatus === "closed") {
      expectedPallets = Math.max(0, Number(vehicleContext.vehicle.total_pallets ?? 0));
    } else if (grossPerPallet > 0) {
      expectedPallets = Math.min(26, Math.floor(21500 / grossPerPallet));
      if (expectedPallets < 1) expectedPallets = 1;
    } else {
      expectedPallets = 26;
    }
    const freightPerPallet = expectedPallets > 0 ? vehicleLogUsd / expectedPallets : 0;
    const transportPerKg = netPerPallet > 0 ? freightPerPallet / netPerPallet : 0;
    components.transportPerKg = transportPerKg;
  }

  // Full preview total only if all required draft fields filled.
  let value: { indicative: number; invoice: number } | null = null;
  if (
    sh &&
    refs &&
    getMissingDraftFields(d, products).length === 0 &&
    unitUsd != null &&
    components.transportPerKg != null &&
    components.customsIndicative != null &&
    components.customsInvoice != null
  ) {
    value = {
      indicative: unitUsd + components.transportPerKg + components.customsIndicative,
      invoice: unitUsd + components.transportPerKg + components.customsInvoice,
    };
  }

  return { value, components };
}

// -----------------------------------------------------------------------------
// Payload builder (verbatim from $id.products.tsx L1424-L1456).
// Excludes trigger-owned fields: customs_match_id, customs_cost_indicative,
// customs_cost_invoice, final_cost_indicative, final_cost_invoice.
// -----------------------------------------------------------------------------

export function buildPayload(
  d: DraftRow,
  ctx: { products: ProductRef[]; shipmentId: string },
  opts: { forUpdate: boolean },
): Record<string, unknown> {
  const pc = d.pallet_count;
  const net = d.net_weight_kg;
  const palletWeightShim = pc > 0 ? net / pc : 0;
  const resolvedName =
    resolveProductOption(d.product_name, ctx.products.map((p) => p.name)) ??
    canonicalizeProductName(d.product_name);
  const payload: Record<string, unknown> = {
    product_name: resolvedName,
    variety: d.variety || null,
    origin_country: normalizeCountry(d.origin_country) || null,
    caliber: d.caliber || null,
    sku: d.sku || null,
    package_used: d.package_used.trim() || null,
    pallet_count: pc,
    net_weight_kg: net,
    gross_weight_kg: d.gross_weight_kg,
    resolver_net_per_pallet_kg: d.resolver_net_per_pallet_kg,
    resolver_gross_per_pallet_kg: d.resolver_gross_per_pallet_kg,
    net_auto: d.net_auto,
    gross_auto: d.gross_auto,
    pallet_weight: palletWeightShim,
    qty: net,
    unit: "kg",
    unit_price: d.unit_price,
    price_currency: d.price_currency,
    // R1A — brand/class persisted for both INSERT and UPDATE. Trimmed value
    // or NULL when blank. Optional in DraftRow (defaults to "" via
    // emptyDraftRow / itemRowToDraft).
    brand: d.brand?.trim() ? d.brand.trim() : null,
    class: d.class?.trim() ? d.class.trim() : null,
  };
  if (!opts.forUpdate) payload.shipment_id = ctx.shipmentId;
  return payload;
}

// -----------------------------------------------------------------------------
// Pure rules (Build A.1 mechanical extraction).
// -----------------------------------------------------------------------------

// Mobile-typo guard: net must not exceed gross. Verbatim from
// $id.products.tsx L1096-L1098.
export function isNetGreaterThanGross(d: {
  net_weight_kg: number | null | undefined;
  gross_weight_kg: number | null | undefined;
}): boolean {
  const n = Number(d.net_weight_kg);
  const g = Number(d.gross_weight_kg);
  return n > 0 && g > 0 && n > g;
}

// Gross-first capacity reducer. Verbatim from $id.products.tsx
// L859-L864 / L1106-L1110 / L2076-L2082 / L2184-L2189:
//   pallets  = Σ pallet_count
//   grossKg  = Σ (gross_weight_kg > 0 ? gross_weight_kg : pallet_count * pallet_weight)
export type CapacityItemLike = {
  pallet_count: number | null | undefined;
  pallet_weight?: number | null | undefined;
  gross_weight_kg?: number | null | undefined;
};

export function sumCapacity(items: readonly CapacityItemLike[]): {
  pallets: number;
  grossKg: number;
} {
  let pallets = 0;
  let grossKg = 0;
  for (const it of items) {
    const pc = Number(it.pallet_count ?? 0);
    pallets += pc;
    const g = Number(it.gross_weight_kg ?? 0);
    grossKg += g > 0 ? g : pc * Number(it.pallet_weight ?? 0);
  }
  return { pallets, grossKg };
}


// Cost-price calculation. All values in USD.
// Customs has two paths: indicative (Euro1) and invoice (VAT + customs fee).

export type CustomsRef = {
  threshold_price_usd: number;
  customs_fee_percent: number;
  euro1_markup_usd: number;
};

export type CustomsResult = {
  indicative: number;
  invoice: number;
  vatPart: number;
  base: number;
  customsFee: number;
  matched: boolean;
};

export function computeCustoms(unitPriceUsd: number, ref: CustomsRef | null | undefined): CustomsResult {
  const u = Number(unitPriceUsd || 0);
  if (!ref) {
    return { indicative: 0, invoice: 0, vatPart: 0, base: u, customsFee: 0, matched: false };
  }
  const indicative = Number(ref.euro1_markup_usd || 0);
  if (u <= Number(ref.threshold_price_usd || 0)) {
    return { indicative, invoice: indicative, vatPart: 0, base: u, customsFee: 0, matched: true };
  }
  const vatPart = u * 0.2;
  const result2 = u + vatPart;
  const customsFee = (result2 * Number(ref.customs_fee_percent || 0)) / 100;
  const invoice = vatPart + customsFee + 0.015;
  return { indicative, invoice, vatPart, base: u, customsFee, matched: true };
}

export function computeFinalCost(unitPriceUsd: number, transportPerKgUsd: number, customsUsd: number): number {
  return Number(unitPriceUsd || 0) + Number(transportPerKgUsd || 0) + Number(customsUsd || 0);
}

export const fmtUsdPerKg = (v: number) =>
  `${new Intl.NumberFormat("uk-UA", { style: "currency", currency: "USD", maximumFractionDigits: 3 }).format(v || 0)}/кг`;

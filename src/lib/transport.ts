// Transport cost allocation by product weight (USD-based).
// Customs / final cost handled separately.

export type TransportItemInput = {
  id: string;
  pallet_count?: number | null;
  pallet_weight?: number | null;
};

export type TransportAllocationRow = {
  id: string;
  productTotalWeight: number;
  weightShare: number; // 0..1
  allocatedTransportCost: number;
  transportCostPerKg: number;
};

export type TransportAllocation = {
  shipmentTotalWeight: number;
  totalTransportCost: number;
  rows: Record<string, TransportAllocationRow>;
};

export function productTotalWeight(it: TransportItemInput): number {
  return Number(it.pallet_count ?? 0) * Number(it.pallet_weight ?? 0);
}

export function allocateTransport(
  items: TransportItemInput[],
  shipmentTotalTransportCost: number,
): TransportAllocation {
  const total = items.reduce((a, it) => a + productTotalWeight(it), 0);
  const rows: Record<string, TransportAllocationRow> = {};
  for (const it of items) {
    const w = productTotalWeight(it);
    const share = total > 0 ? w / total : 0;
    const allocated = shipmentTotalTransportCost * share;
    const perKg = w > 0 ? allocated / w : 0;
    rows[it.id] = {
      id: it.id,
      productTotalWeight: w,
      weightShare: share,
      allocatedTransportCost: allocated,
      transportCostPerKg: perKg,
    };
  }
  return { shipmentTotalWeight: total, totalTransportCost: shipmentTotalTransportCost, rows };
}

// Generic money formatter (kept for backwards compat). Prefer fmtUSD from "@/lib/currency".
export const fmtMoney = (v: number, currency = "USD") =>
  new Intl.NumberFormat("uk-UA", { style: "currency", currency, maximumFractionDigits: 2 }).format(v || 0);

export const fmtKg = (v: number) =>
  `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format(v || 0)} кг`;

export const fmtPct = (v: number) =>
  `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format((v || 0) * 100)}%`;

// Transport cost allocation by product weight (USD-based).
// Mirrors Postgres calc_shipment_item_costs():
//   BEFORE vehicle close (open / no vehicle):
//     avg_kg_per_pallet = pallet_weight   (== row_total_weight / row_pallet_count)
//     expected_pallets  = min(26, floor(21500 / avg_kg_per_pallet))
//     transport_per_pallet = total_transport_usd / expected_pallets
//     transport_per_kg     = transport_per_pallet / avg_kg_per_pallet
//   AFTER vehicle close:
//     total_closed_pallets = sum(pallet_count) for all rows in closed vehicle
//     transport_per_pallet = total_transport_usd / total_closed_pallets
//     transport_per_kg     = transport_per_pallet / avg_kg_per_pallet (per row)

const VEHICLE_MAX_KG = 21500;
const VEHICLE_MAX_PALLETS = 26;

export type TransportItemInput = {
  id: string;
  pallet_count?: number | null;
  pallet_weight?: number | null;
};

export type TransportAllocationRow = {
  id: string;
  productTotalWeight: number;
  weightShare: number; // 0..1 — display only
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
  vehicleClosed: boolean = false,
): TransportAllocation {
  const shipmentTotalWeight = items.reduce((a, it) => a + productTotalWeight(it), 0);
  const totalClosedPallets = items.reduce((a, it) => a + Number(it.pallet_count ?? 0), 0);

  const rows: Record<string, TransportAllocationRow> = {};
  for (const it of items) {
    const pc = Number(it.pallet_count ?? 0);
    const pw = Number(it.pallet_weight ?? 0); // avg kg per pallet
    const w = pc * pw;

    let perPallet = 0;
    let perKg = 0;

    if (vehicleClosed) {
      if (totalClosedPallets > 0) {
        perPallet = shipmentTotalTransportCost / totalClosedPallets;
      }
      if (pw > 0) perKg = perPallet / pw;
    } else {
      let expectedPallets = VEHICLE_MAX_PALLETS;
      if (pw > 0) {
        expectedPallets = Math.min(VEHICLE_MAX_PALLETS, Math.floor(VEHICLE_MAX_KG / pw));
        if (expectedPallets < 1) expectedPallets = 1;
      }
      if (expectedPallets > 0) {
        perPallet = shipmentTotalTransportCost / expectedPallets;
      }
      if (pw > 0) perKg = perPallet / pw;
    }

    const allocated = perPallet * pc;
    const share = shipmentTotalWeight > 0 ? w / shipmentTotalWeight : 0;

    rows[it.id] = {
      id: it.id,
      productTotalWeight: w,
      weightShare: share,
      allocatedTransportCost: allocated,
      transportCostPerKg: perKg,
    };
  }
  return { shipmentTotalWeight, totalTransportCost: shipmentTotalTransportCost, rows };
}

// Generic money formatter (kept for backwards compat). Prefer fmtUSD from "@/lib/currency".
export const fmtMoney = (v: number, currency = "USD") =>
  new Intl.NumberFormat("uk-UA", { style: "currency", currency, maximumFractionDigits: 2 }).format(v || 0);

export const fmtKg = (v: number) =>
  `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format(v || 0)} кг`;

export const fmtPct = (v: number) =>
  `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format((v || 0) * 100)}%`;

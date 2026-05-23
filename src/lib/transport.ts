// Transport cost allocation by product weight (USD-based).
// Mirrors Postgres calc_shipment_item_costs() after 9F:
//   net_per_pallet   = net_weight_kg   / pallet_count  (fallback: pallet_weight)
//   gross_per_pallet = gross_weight_kg / pallet_count  (fallback: pallet_weight)
//   line_net_kg      = net_weight_kg                   (fallback: pallet_count * pallet_weight)
//
//   BEFORE vehicle close (open / no vehicle):
//     expected_pallets     = min(26, floor(21500 / gross_per_pallet))   -- capacity-side
//     transport_per_pallet = total_transport_usd / expected_pallets
//     transport_per_kg     = transport_per_pallet / net_per_pallet      -- cost-side
//   AFTER vehicle close:
//     total_closed_pallets = sum(pallet_count)
//     transport_per_pallet = total_transport_usd / total_closed_pallets
//     transport_per_kg     = transport_per_pallet / net_per_pallet      -- cost-side per row

const VEHICLE_MAX_KG = 21500;
const VEHICLE_MAX_PALLETS = 26;

export type TransportItemInput = {
  id: string;
  pallet_count?: number | null;
  pallet_weight?: number | null; // legacy fallback only
  net_weight_kg?: number | null;
  gross_weight_kg?: number | null;
};

export type TransportAllocationRow = {
  id: string;
  productTotalWeight: number; // net (cost-side line weight)
  weightShare: number; // 0..1 — display only
  allocatedTransportCost: number;
  transportCostPerKg: number;
};

export type TransportAllocation = {
  shipmentTotalWeight: number; // sum of net line weights
  totalTransportCost: number;
  rows: Record<string, TransportAllocationRow>;
};

function netPerPallet(it: TransportItemInput): number {
  const pc = Number(it.pallet_count ?? 0);
  const n = Number(it.net_weight_kg ?? 0);
  if (n > 0 && pc > 0) return n / pc;
  return Number(it.pallet_weight ?? 0); // legacy fallback
}

function grossPerPallet(it: TransportItemInput): number {
  const pc = Number(it.pallet_count ?? 0);
  const g = Number(it.gross_weight_kg ?? 0);
  if (g > 0 && pc > 0) return g / pc;
  return Number(it.pallet_weight ?? 0); // legacy fallback
}

function lineNetKg(it: TransportItemInput): number {
  const n = Number(it.net_weight_kg ?? 0);
  if (n > 0) return n;
  return Number(it.pallet_count ?? 0) * Number(it.pallet_weight ?? 0);
}

// Cost-side line weight (net). Kept named for backwards compat.
export function productTotalWeight(it: TransportItemInput): number {
  return lineNetKg(it);
}

export function allocateTransport(
  items: TransportItemInput[],
  shipmentTotalTransportCost: number,
  vehicleClosed: boolean = false,
): TransportAllocation {
  const shipmentTotalWeight = items.reduce((a, it) => a + lineNetKg(it), 0);
  const totalClosedPallets = items.reduce((a, it) => a + Number(it.pallet_count ?? 0), 0);

  const rows: Record<string, TransportAllocationRow> = {};
  for (const it of items) {
    const pc = Number(it.pallet_count ?? 0);
    const nPerPal = netPerPallet(it);   // cost-side
    const gPerPal = grossPerPallet(it); // capacity-side
    const w = lineNetKg(it);

    let perPallet = 0;
    let perKg = 0;

    if (vehicleClosed) {
      if (totalClosedPallets > 0) {
        perPallet = shipmentTotalTransportCost / totalClosedPallets;
      }
      if (nPerPal > 0) perKg = perPallet / nPerPal;
    } else {
      let expectedPallets = VEHICLE_MAX_PALLETS;
      if (gPerPal > 0) {
        expectedPallets = Math.min(VEHICLE_MAX_PALLETS, Math.floor(VEHICLE_MAX_KG / gPerPal));
        if (expectedPallets < 1) expectedPallets = 1;
      }
      if (expectedPallets > 0) {
        perPallet = shipmentTotalTransportCost / expectedPallets;
      }
      if (nPerPal > 0) perKg = perPallet / nPerPal;
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

// Build 2B-B-2 — Этап A.
// Sequential client-side orchestrator that materialises the local
// /shipments/new draft into:
//   1) vehicles (new, open)
//   2) shipments (parent)
//   3) shipment_items (+ position_id via existing commit helper)
//   4) optional: vehicles.status = 'closed'  (scenario "create_and_close")
//
// Hard rules respected:
//   * No DB schema / RLS / trigger / RPC changes.
//   * No new shared-component changes.
//   * Reuses existing helpers:
//       - fetchNextVehicleSequence / fetchNextSupplierSequence
//       - getSupplierAlias / getCountryCode / formatVehicleCode / formatShipmentCode
//       - buildPayload (shipment_row_engine)
//       - commitNewShipmentItem (commit-shipment-row)
//       - rollbackBirthPosition (position-attach)
//   * Best-effort sequential rollback on failure:
//       items (delete + rollback freshly minted positions)
//       → shipment (delete)
//       → vehicle (delete).
//     If a rollback step itself fails, it is logged + reported so the caller
//     can surface artefact ids to the user.

import { supabase } from "@/integrations/supabase/client";
import {
  buildPayload as buildShipmentItemPayload,
  type DraftRow,
  type ProductRef,
} from "@/lib/shipment-row-engine";
import { commitNewShipmentItem } from "@/lib/commit-shipment-row";
import { rollbackBirthPosition } from "@/lib/position-attach";
import {
  fetchNextSupplierSequence,
  fetchNextVehicleSequence,
  formatShipmentCode,
  formatVehicleCode,
  getCountryCode,
  getSupplierAlias,
} from "@/lib/shipment-code";
import { getLatestEurUsdRate } from "@/lib/currency";

export type CreateShipmentScenario = "create" | "create_and_close";

export type CreateShipmentInput = {
  scenario: CreateShipmentScenario;
  userId: string;
  supplier: {
    id: string;
    name: string | null;
    alias: string | null;
    code_base: string | null;
    import_manager_id: string | null;
  };
  country: string;                  // canonical UA country name
  loadingDate: string;              // YYYY-MM-DD
  eta: string;                      // YYYY-MM-DD
  transportAmount: number;          // > 0
  transportCurrency: "EUR" | "USD";
  drafts: DraftRow[];               // already validated non-empty
  products: ProductRef[];
};

export type CreateShipmentSuccess = {
  ok: true;
  vehicleId: string;
  vehicleCode: string;
  shipmentId: string;
  shipmentCode: string;
  closed: boolean;
};

export type CreateShipmentFailure = {
  ok: false;
  stage:
    | "sequence_vehicle"
    | "sequence_supplier"
    | "fx_rate"
    | "insert_vehicle"
    | "insert_shipment"
    | "insert_items"
    | "close_vehicle";
  reason: string;
  /** Artefacts that survived the rollback attempt — must be surfaced to user. */
  artefacts?: {
    vehicleId?: string;
    shipmentId?: string;
    itemIds?: string[];
    positionIds?: string[];
  };
};

export type CreateShipmentResult = CreateShipmentSuccess | CreateShipmentFailure;

const safeReason = (e: unknown): string =>
  e instanceof Error ? e.message : typeof e === "string" ? e : "unknown_error";

export async function createShipmentFlow(
  input: CreateShipmentInput,
): Promise<CreateShipmentResult> {
  const {
    scenario,
    userId,
    supplier,
    country,
    loadingDate,
    eta,
    transportAmount,
    transportCurrency,
    drafts,
    products,
  } = input;

  const alias = getSupplierAlias(supplier);
  const countryCode = getCountryCode(country);

  // 1. Sequences (read-only RPC) — fetched fresh just before writes.
  let vehicleSeq: number;
  try {
    vehicleSeq = await fetchNextVehicleSequence(countryCode);
  } catch (e) {
    return { ok: false, stage: "sequence_vehicle", reason: safeReason(e) };
  }
  let supplierSeq: number;
  try {
    supplierSeq = await fetchNextSupplierSequence(supplier.id);
  } catch (e) {
    return { ok: false, stage: "sequence_supplier", reason: safeReason(e) };
  }

  const vehicleCode = formatVehicleCode(countryCode, vehicleSeq);
  const shipmentCode = formatShipmentCode({ alias, supplierSeq, vehicleCode });

  // 2. FX rate (only when freight or any item price is in EUR).
  const needFx =
    transportCurrency === "EUR" ||
    drafts.some((d) => d.price_currency === "EUR");
  let eurUsd: { rate: number; date: string } | null = null;
  if (needFx) {
    try {
      eurUsd = await getLatestEurUsdRate();
    } catch (e) {
      return { ok: false, stage: "fx_rate", reason: safeReason(e) };
    }
    if (!eurUsd) {
      return {
        ok: false,
        stage: "fx_rate",
        reason: "Не знайдено курс EUR→USD у exchange_rates",
      };
    }
  }
  const fxRate = eurUsd?.rate ?? null;
  const fxDate = eurUsd?.date ?? null;

  const logisticsCostUsd =
    transportCurrency === "USD"
      ? transportAmount
      : fxRate != null
        ? Number((transportAmount * fxRate).toFixed(2))
        : null;

  // 3. INSERT vehicle.
  const vehiclePayload = {
    code: vehicleCode,
    country,
    country_code: countryCode,
    sequence_no: vehicleSeq,
    loading_date: loadingDate,
    eta,
    created_by: userId,
    // status omitted → DB default 'open'.
  };
  const vIns = await supabase
    .from("vehicles" as never)
    .insert(vehiclePayload as never)
    .select("id")
    .single();
  if (vIns.error || !vIns.data) {
    return {
      ok: false,
      stage: "insert_vehicle",
      reason: safeReason(vIns.error ?? new Error("vehicle_insert_failed")),
    };
  }
  const vehicleId = (vIns.data as { id: string }).id;

  // 4. INSERT shipment (parent — single source of freight for this auto in
  //    scenario A; scenario "довантаження" will be added later and forces 0).
  const shipmentPayload: Record<string, unknown> = {
    code: shipmentCode,
    vehicle_id: vehicleId,
    supplier_id: supplier.id,
    supplier_seq: supplierSeq,
    country,
    loading_date: loadingDate,
    eta,
    logistics_cost: transportAmount,
    logistics_cost_currency: transportCurrency,
    logistics_cost_usd: logisticsCostUsd,
    created_by: userId,
    import_manager_id: supplier.import_manager_id ?? null,
  };
  if (fxRate != null) {
    shipmentPayload.eur_usd_rate = fxRate;
    shipmentPayload.eur_usd_rate_source = "auto";
    if (fxDate) shipmentPayload.eur_usd_rate_date = fxDate;
  }

  const sIns = await supabase
    .from("shipments")
    .insert(shipmentPayload as never)
    .select("id")
    .single();
  if (sIns.error || !sIns.data) {
    const reason = safeReason(sIns.error ?? new Error("shipment_insert_failed"));
    // Rollback vehicle.
    const delV = await supabase.from("vehicles" as never).delete().eq("id", vehicleId);
    return {
      ok: false,
      stage: "insert_shipment",
      reason,
      artefacts: delV.error ? { vehicleId } : undefined,
    };
  }
  const shipmentId = (sIns.data as { id: string }).id;

  // 5. INSERT shipment_items via existing commit helper. Track artefacts so
  //    we can roll back precisely on partial failure.
  const insertedItemIds: string[] = [];
  const createdPositionIds: string[] = [];

  for (const draft of drafts) {
    const basePayload = buildShipmentItemPayload(
      draft,
      { products, shipmentId },
      { forUpdate: false },
    );
    // Preserve manual customs override (single existing column).
    if (
      draft.customs_override_duty_usd != null &&
      Number(draft.customs_override_duty_usd) > 0
    ) {
      basePayload.customs_override_duty_usd = Number(draft.customs_override_duty_usd);
    }
    const res = await commitNewShipmentItem({
      shipmentId,
      draft: {
        localId: draft.localId,
        source_offer_id: draft.source_offer_id,
        source_position_id: draft.source_position_id,
        product_name: draft.product_name,
        origin_country: draft.origin_country,
        caliber: draft.caliber,
        package_used: draft.package_used,
        pallet_count: draft.pallet_count,
      },
      payload: basePayload,
      responsibleManagerId: supplier.import_manager_id ?? userId,
    });
    if (!res.ok) {
      // Rollback inserted items (and freshly minted positions) + shipment + vehicle.
      if (res.createdPositionId) createdPositionIds.push(res.createdPositionId);
      const artefacts = await bestEffortRollback({
        vehicleId,
        shipmentId,
        itemIds: insertedItemIds,
        positionIds: createdPositionIds,
      });
      return {
        ok: false,
        stage: "insert_items",
        reason: res.reason,
        artefacts: artefacts ?? undefined,
      };
    }
    insertedItemIds.push(res.itemId);
    if (res.createdPositionId) createdPositionIds.push(res.createdPositionId);
  }

  // 6. Optional close (scenario "create_and_close").
  let closed = false;
  if (scenario === "create_and_close") {
    const upd = await supabase
      .from("vehicles" as never)
      .update({ status: "closed", closed_at: new Date().toISOString() } as never)
      .eq("id", vehicleId);
    if (upd.error) {
      // Do NOT rollback the shipment — it's a successful create; just surface
      // the close failure to the caller so they can retry close manually.
      return {
        ok: false,
        stage: "close_vehicle",
        reason: safeReason(upd.error),
        artefacts: { vehicleId, shipmentId, itemIds: insertedItemIds },
      };
    }
    closed = true;
  }

  return {
    ok: true,
    vehicleId,
    vehicleCode,
    shipmentId,
    shipmentCode,
    closed,
  };
}

/**
 * Sequential best-effort rollback. Returns the set of artefacts that
 * survived (i.e. could NOT be deleted) so the caller can show them to the
 * user. Never throws.
 */
async function bestEffortRollback(input: {
  vehicleId: string | null;
  shipmentId: string | null;
  itemIds: string[];
  positionIds: string[];
}): Promise<CreateShipmentFailure["artefacts"] | null> {
  const survivors: NonNullable<CreateShipmentFailure["artefacts"]> = {};
  // Items first.
  if (input.itemIds.length > 0) {
    const delItems = await supabase
      .from("shipment_items")
      .delete()
      .in("id", input.itemIds);
    if (delItems.error) survivors.itemIds = input.itemIds;
  }
  // Freshly minted positions next (safe RPC, never throws).
  for (const pid of input.positionIds) {
    await rollbackBirthPosition(pid);
  }
  // Shipment.
  if (input.shipmentId) {
    const delShip = await supabase
      .from("shipments")
      .delete()
      .eq("id", input.shipmentId);
    if (delShip.error) survivors.shipmentId = input.shipmentId;
  }
  // Vehicle.
  if (input.vehicleId) {
    const delVeh = await supabase
      .from("vehicles" as never)
      .delete()
      .eq("id", input.vehicleId);
    if (delVeh.error) survivors.vehicleId = input.vehicleId;
  }
  const hasSurvivors =
    !!survivors.vehicleId ||
    !!survivors.shipmentId ||
    (survivors.itemIds && survivors.itemIds.length > 0);
  return hasSurvivors ? survivors : null;
}

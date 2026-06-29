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
  country: string;                  // canonical UA country name (ignored in child mode)
  loadingDate: string;              // YYYY-MM-DD (ignored in child mode)
  eta: string;                      // YYYY-MM-DD (ignored in child mode)
  transportAmount: number;          // > 0 in standalone; ignored (forced 0) in child mode
  transportCurrency: "EUR" | "USD"; // ignored (forced USD) in child mode
  drafts: DraftRow[];               // already validated non-empty
  products: ProductRef[];
  /** Build 2D — child mode: child shipment inside an existing open vehicle. */
  mode?: "standalone" | "child";
  parentVehicleId?: string;         // required when mode='child'
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
    | "close_vehicle"
    | "parent_fetch"      // Build 2D — child mode: parent vehicle missing/closed
    | "capacity_guard";   // Build 2D — child mode: not enough free pallets/gross
  reason: string;
  /** Artefacts that survived the rollback attempt — must be surfaced to user. */
  artefacts?: {
    vehicleId?: string;
    shipmentId?: string;
    itemIds?: string[];
    positionIds?: string[];
  };
  /**
   * True when the shipment + vehicle + items were created successfully and
   * only a non-critical follow-up step failed (currently: closing the vehicle
   * in "create_and_close" scenario). The caller MUST treat this as a warning,
   * not an error: nothing is rolled back, the vehicle simply stays open.
   */
  partialSuccess?: boolean;
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
    drafts,
    products,
  } = input;

  const isChild = input.mode === "child" && !!input.parentVehicleId;

  // Build 2D — child mode forbids "create_and_close". Defensive guard
  // (UI does not surface that option in child mode either).
  if (isChild && scenario === "create_and_close") {
    return {
      ok: false,
      stage: "parent_fetch",
      reason: "Сценарій 'Створити та закрити' недоступний у режимі довантаження",
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // Child mode: re-read parent vehicle from DB (source of truth) BEFORE any
  // sequence/FX work. Inherits country / loading_date / eta / code; ignores
  // freight/currency inputs from the form.
  // ────────────────────────────────────────────────────────────────────────
  let parentVehicle: {
    id: string;
    code: string;
    country: string;
    loading_date: string | null;
    eta: string | null;
    status: string;
  } | null = null;
  if (isChild) {
    const pv = (await supabase
      .from("vehicles" as never)
      .select("id,code,country,loading_date,eta,status")
      .eq("id", input.parentVehicleId!)
      .maybeSingle()) as {
        data: {
          id: string;
          code: string;
          country: string;
          loading_date: string | null;
          eta: string | null;
          status: string;
        } | null;
        error: { message: string } | null;
      };
    if (pv.error || !pv.data) {
      return {
        ok: false,
        stage: "parent_fetch",
        reason: safeReason(pv.error ?? new Error("parent_vehicle_not_found")),
      };
    }
    if (pv.data.status !== "open") {
      return {
        ok: false,
        stage: "parent_fetch",
        reason: `Авто вже не у статусі 'open' (поточний статус: '${pv.data.status}'). Оновіть список і спробуйте ще раз.`,
      };
    }
    parentVehicle = pv.data;
  }

  // Effective parent-derived fields (used everywhere downstream).
  const effCountry = parentVehicle?.country ?? input.country;
  const effLoadingDate = parentVehicle?.loading_date ?? input.loadingDate;
  const effEta = parentVehicle?.eta ?? input.eta;
  // In child mode freight is forced to 0 USD regardless of form input.
  const transportAmount = isChild ? 0 : input.transportAmount;
  const transportCurrency: "EUR" | "USD" = isChild ? "USD" : input.transportCurrency;

  const alias = getSupplierAlias(supplier);
  const countryCode = getCountryCode(effCountry);

  // 1. Sequences. Vehicle sequence is NOT consumed in child mode.
  let vehicleSeq: number | null = null;
  if (!isChild) {
    try {
      vehicleSeq = await fetchNextVehicleSequence(countryCode);
    } catch (e) {
      return { ok: false, stage: "sequence_vehicle", reason: safeReason(e) };
    }
  }
  let supplierSeq: number;
  try {
    supplierSeq = await fetchNextSupplierSequence(supplier.id);
  } catch (e) {
    return { ok: false, stage: "sequence_supplier", reason: safeReason(e) };
  }

  const vehicleCode = isChild
    ? parentVehicle!.code
    : formatVehicleCode(countryCode, vehicleSeq!);
  const shipmentCode = formatShipmentCode({ alias, supplierSeq, vehicleCode });

  // 2. FX rate. In child mode transport=USD forced, so FX is only needed when
  //    at least one item is priced in EUR (per Build 2D §7).
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

  const logisticsCostUsd = isChild
    ? 0
    : transportCurrency === "USD"
      ? transportAmount
      : fxRate != null
        ? Number((transportAmount * fxRate).toFixed(2))
        : null;

  // 3. INSERT vehicle — standalone only. Child mode reuses parent vehicle.
  let vehicleId: string;
  if (isChild) {
    vehicleId = parentVehicle!.id;

    // 3b. Capacity guard (freshness-check, NOT atomic — race window remains
    //     between this SELECT and the shipment_items INSERT below). Atomic
    //     enforcement would need a DB-level trigger/RPC — out of scope for 2D.
    const cap = (await supabase
      .from("shipment_items")
      .select(
        "pallet_count,pallet_weight,net_weight_kg,gross_weight_kg,shipments!inner(vehicle_id)",
      )
      .eq("shipments.vehicle_id", vehicleId)) as {
        data:
          | {
              pallet_count: number | null;
              pallet_weight: number | null;
              net_weight_kg: number | null;
              gross_weight_kg: number | null;
            }[]
          | null;
        error: { message: string } | null;
      };
    if (cap.error) {
      return { ok: false, stage: "capacity_guard", reason: safeReason(cap.error) };
    }
    let usedPallets = 0;
    let usedGross = 0;
    for (const it of cap.data ?? []) {
      const pc = Number(it.pallet_count ?? 0);
      usedPallets += pc;
      const g = Number(it.gross_weight_kg ?? 0);
      if (g > 0) usedGross += g;
      else {
        const net = Number(it.net_weight_kg ?? 0);
        const pw = Number(it.pallet_weight ?? 0);
        usedGross += net > 0 ? net : pc * pw;
      }
    }
    let draftPallets = 0;
    let draftGross = 0;
    for (const d of drafts) {
      const pc = Number(d.pallet_count ?? 0);
      draftPallets += pc;
      const g = Number(d.gross_weight_kg ?? 0);
      if (g > 0) draftGross += g;
      else {
        const net = Number(d.net_weight_kg ?? 0);
        draftGross += net > 0 ? net : 0;
      }
    }
    const CAP_PAL = 26;
    const CAP_GROSS = 21500;
    if (usedPallets + draftPallets > CAP_PAL || usedGross + draftGross > CAP_GROSS) {
      const freePal = Math.max(0, CAP_PAL - usedPallets);
      const freeGross = Math.max(0, CAP_GROSS - usedGross);
      return {
        ok: false,
        stage: "capacity_guard",
        reason: `Недостатньо вільного місця в авто ${parentVehicle!.code}: вільно ${freePal} пал / ${Math.round(freeGross)} кг, потрібно ${draftPallets} пал / ${Math.round(draftGross)} кг`,
      };
    }
  } else {
    const vehiclePayload = {
      code: vehicleCode,
      country: effCountry,
      country_code: countryCode,
      sequence_no: vehicleSeq!,
      loading_date: effLoadingDate,
      eta: effEta,
      created_by: userId,
      // status omitted → DB default 'open'.
    };
    const vIns = (await supabase
      .from("vehicles" as never)
      .insert(vehiclePayload as never)
      .select("id")
      .single()) as { data: { id: string } | null; error: { message: string } | null };
    if (vIns.error || !vIns.data) {
      return {
        ok: false,
        stage: "insert_vehicle",
        reason: safeReason(vIns.error ?? new Error("vehicle_insert_failed")),
      };
    }
    vehicleId = vIns.data.id;
  }

  // 4. INSERT shipment (parent — single source of freight for this auto in
  //    scenario A; scenario "довантаження" will be added later and forces 0).
  const shipmentPayload: Record<string, unknown> = {
    code: shipmentCode,
    vehicle_id: vehicleId,
    supplier_id: supplier.id,
    supplier_seq: supplierSeq,
    country: effCountry,
    loading_date: effLoadingDate,
    eta: effEta,
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
  const shipmentId = (sIns.data as unknown as { id: string }).id;

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
    // Preserve manual customs override + confirmation metadata so the
    // newly created shipment opens with the override already "confirmed"
    // and the cost calculation matches the /shipments/new preview.
    if (
      draft.customs_override_duty_usd != null &&
      Number(draft.customs_override_duty_usd) > 0
    ) {
      basePayload.customs_override_duty_usd = Number(draft.customs_override_duty_usd);
      basePayload.customs_override_confirmed_at = new Date().toISOString();
      basePayload.customs_override_by = userId;
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
    const upd = (await supabase
      .from("vehicles" as never)
      .update({ status: "closed", closed_at: new Date().toISOString() } as never)
      .eq("id", vehicleId)
      .select("id,status")
      .maybeSingle()) as {
        data: { id: string; status: string } | null;
        error: { message: string } | null;
      };
    const actuallyClosed = !upd.error && upd.data?.status === "closed";
    if (!actuallyClosed) {
      // Do NOT rollback the shipment — it's a successful create; just surface
      // the close failure to the caller so they can retry close manually.
      const reason = upd.error
        ? safeReason(upd.error)
        : upd.data == null
          ? "Закриття не підтверджено (рядок vehicles не повернувся — можливо, RLS/тригер заборонив)"
          : `Статус авто залишився '${upd.data.status}', очікувалось 'closed'`;
      return {
        ok: false,
        stage: "close_vehicle",
        reason,
        artefacts: { vehicleId, shipmentId, itemIds: insertedItemIds },
        partialSuccess: true,
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

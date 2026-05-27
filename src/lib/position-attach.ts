// Position anchor wiring for new manager_offers rows.
// New offers must either get manager_offers.position_id or fail atomically
// from the UI caller, which then removes the freshly created offer rows.
// This module is the ONLY place the UI birth-flow mints a position_id.

import { supabase } from "@/integrations/supabase/client";

type AttachInput = {
  offerId: string;
  productName: string;
  originCountry: string;
  caliber?: string | null;
  packaging?: string | null;
  responsibleManagerId?: string | null;
};

export type AttachResult =
  | { attached: true; positionId: string }
  | {
      attached: false;
      stage:
        | "resolve_product"
        | "resolve_country"
        | "create_draft"
        | "attach_offer"
        | "verify_offer_position";
      reason: string;
    };

export async function resolveProductId(name: string): Promise<string | null> {
  const n = name.trim();
  if (!n) return null;
  const { data, error } = await supabase.rpc("rpc_resolve_product_exact", {
    p_query: n,
    p_include_reserve: false,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  if (!row || row.status !== "matched" || !row.dictionary_id) return null;
  return row.dictionary_id as string;
}

export async function resolveCountryId(name: string): Promise<string | null> {
  const n = name.trim();
  if (!n) return null;
  const { data, error } = await supabase.rpc("rpc_resolve_country", {
    p_input: n,
  });
  if (error) throw error;

  const resolvedCountryName =
    Array.isArray(data) && data[0]?.status === "matched" && data[0]?.country_name
      ? (data[0].country_name as string)
      : n;

  const canonical = await supabase
    .from("countries")
    .select("id")
    .ilike("name", resolvedCountryName)
    .limit(1)
    .maybeSingle();
  if (canonical.error) throw canonical.error;
  if (canonical.data?.id) return canonical.data.id as string;

  if (resolvedCountryName.toLowerCase() === n.toLowerCase()) return null;

  const direct = await supabase
    .from("countries")
    .select("id")
    .ilike("name", n)
    .limit(1)
    .maybeSingle();
  if (direct.error) throw direct.error;
  return (direct.data?.id as string | undefined) ?? null;
}

/**
 * Create operational_position (draft) and attach the offer.
 * - Does not overwrite an existing manager_offers.position_id.
 * - Idempotent via source_context/source_row_key keyed to offer id.
 * - Any failure is fatal for the caller's new-offer flow.
 */
export async function attachOfferToPosition(
  input: AttachInput,
): Promise<AttachResult> {
  let productId: string | null;
  try {
    productId = await resolveProductId(input.productName);
  } catch (error) {
    return {
      attached: false,
      stage: "resolve_product",
      reason: (error as Error).message ?? "unknown_error",
    };
  }
  if (!productId) {
    return {
      attached: false,
      stage: "resolve_product",
      reason: "product_not_resolved",
    };
  }

  let countryId: string | null;
  try {
    countryId = await resolveCountryId(input.originCountry);
  } catch (error) {
    return {
      attached: false,
      stage: "resolve_country",
      reason: (error as Error).message ?? "unknown_error",
    };
  }
  if (!countryId) {
    return {
      attached: false,
      stage: "resolve_country",
      reason: "country_not_resolved",
    };
  }

  let draft:
    | { position_id?: string | null }[]
    | null;
  try {
    const result = await supabase.rpc("rpc_position_create_draft", {
      p_product_id: productId,
      p_product_origin_country_id: countryId,
      p_source_context: "manager_offer",
      p_source_row_key: input.offerId,
      p_client_row_id: input.offerId,
      p_caliber: input.caliber ?? undefined,
      p_package_used: input.packaging ?? undefined,
      p_responsible_manager_id: input.responsibleManagerId ?? undefined,
    });
    if (result.error) {
      return { attached: false, stage: "create_draft", reason: result.error.message };
    }
    draft = result.data as { position_id?: string | null }[] | null;
  } catch (error) {
    return {
      attached: false,
      stage: "create_draft",
      reason: (error as Error).message ?? "unknown_error",
    };
  }

  const positionId = Array.isArray(draft) ? draft[0]?.position_id : null;
  if (!positionId) {
    return {
      attached: false,
      stage: "create_draft",
      reason: "no_position_id_returned",
    };
  }

  try {
    const attachResult = await supabase.rpc("rpc_position_attach_offer", {
      p_offer_id: input.offerId,
      p_position_id: positionId,
      p_responsible_manager_id: input.responsibleManagerId ?? undefined,
    });
    if (attachResult.error) {
      return { attached: false, stage: "attach_offer", reason: attachResult.error.message };
    }
  } catch (error) {
    return {
      attached: false,
      stage: "attach_offer",
      reason: (error as Error).message ?? "unknown_error",
    };
  }

  let persisted;
  try {
    persisted = await supabase
      .from("manager_offers")
      .select("position_id")
      .eq("id", input.offerId)
      .maybeSingle();
  } catch (error) {
    return {
      attached: false,
      stage: "verify_offer_position",
      reason: (error as Error).message ?? "unknown_error",
    };
  }
  if (persisted.error) {
    return {
      attached: false,
      stage: "verify_offer_position",
      reason: persisted.error.message,
    };
  }

  if ((persisted.data?.position_id as string | undefined) !== positionId) {
    return {
      attached: false,
      stage: "verify_offer_position",
      reason: "offer_position_not_persisted",
    };
  }

  return { attached: true, positionId };
}

/**
 * Safe rollback of a freshly-born position from the UI birth-flow.
 * Calls the security-definer RPC that deletes operational_positions +
 * position_events ONLY IF no other links exist (no offers, no shipment_items,
 * no allocation parts, no shipment links). Never throws.
 */
export async function rollbackBirthPosition(positionId: string): Promise<void> {
  try {
    await supabase.rpc("rpc_position_rollback_birth", {
      p_position_id: positionId,
    });
  } catch (error) {
    console.error("[position-attach] rollback failed", positionId, error);
  }
}

// ===========================================================================
// Phase 2: Shipment-item birth-flow position wiring.
// Every NEW shipment_items row created from the UI MUST anchor to a
// position_id. No text-only legacy rows. Failures roll back the inserted
// shipment_item and the freshly-minted position (if safe).
// ===========================================================================

type CreatePositionForShipmentInput = {
  productName: string;
  originCountry: string;
  sourceContext: string;
  sourceRowKey: string;
  clientRowId?: string;
  caliber?: string | null;
  packaging?: string | null;
  responsibleManagerId?: string | null;
  palletQty?: number | null;
};

export type CreatePositionResult =
  | { ok: true; positionId: string }
  | {
      ok: false;
      stage: "resolve_product" | "resolve_country" | "create_draft";
      reason: string;
    };

export async function createPositionForShipmentItem(
  input: CreatePositionForShipmentInput,
): Promise<CreatePositionResult> {
  let productId: string | null;
  try {
    productId = await resolveProductId(input.productName);
  } catch (e) {
    return { ok: false, stage: "resolve_product", reason: (e as Error).message ?? "unknown_error" };
  }
  if (!productId) return { ok: false, stage: "resolve_product", reason: "product_not_resolved" };

  let countryId: string | null;
  try {
    countryId = await resolveCountryId(input.originCountry);
  } catch (e) {
    return { ok: false, stage: "resolve_country", reason: (e as Error).message ?? "unknown_error" };
  }
  if (!countryId) return { ok: false, stage: "resolve_country", reason: "country_not_resolved" };

  try {
    // Defensive guard: p_client_row_id is a uuid in DB. Drop anything that
    // is not a real uuid (e.g. stale "tmp_..." frontend keys) so the RPC
    // doesn't fail with `invalid input syntax for type uuid`.
    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const rawClientRowId = input.clientRowId ?? input.sourceRowKey;
    const safeClientRowId =
      typeof rawClientRowId === "string" && UUID_RE.test(rawClientRowId)
        ? rawClientRowId
        : undefined;

    const res = await supabase.rpc("rpc_position_create_draft", {
      p_product_id: productId,
      p_product_origin_country_id: countryId,
      p_source_context: input.sourceContext,
      p_source_row_key: input.sourceRowKey,
      p_client_row_id: safeClientRowId,
      p_caliber: input.caliber ?? undefined,
      p_package_used: input.packaging ?? undefined,
      p_responsible_manager_id: input.responsibleManagerId ?? undefined,
      p_pallet_qty: input.palletQty ?? undefined,
    });
    if (res.error) return { ok: false, stage: "create_draft", reason: res.error.message };
    const positionId = Array.isArray(res.data) ? (res.data[0]?.position_id as string | undefined) : undefined;
    if (!positionId) return { ok: false, stage: "create_draft", reason: "no_position_id_returned" };
    return { ok: true, positionId };
  } catch (e) {
    return { ok: false, stage: "create_draft", reason: (e as Error).message ?? "unknown_error" };
  }
}

export type AttachShipmentItemResult =
  | { ok: true }
  | { ok: false; stage: "attach_shipment" | "verify_item_position"; reason: string };

/**
 * Attach an existing shipment_items row to an existing operational_positions
 * row via rpc_position_attach_shipment, then verify shipment_items.position_id
 * was persisted. Never mints a position_id.
 */
export async function attachShipmentItemToPosition(input: {
  shipmentItemId: string;
  positionId: string;
  palletQty?: number | null;
}): Promise<AttachShipmentItemResult> {
  try {
    const r = await supabase.rpc("rpc_position_attach_shipment", {
      p_shipment_item_id: input.shipmentItemId,
      p_position_id: input.positionId,
      p_pallet_qty_linked: input.palletQty ?? undefined,
    });
    if (r.error) return { ok: false, stage: "attach_shipment", reason: r.error.message };
  } catch (e) {
    return { ok: false, stage: "attach_shipment", reason: (e as Error).message ?? "unknown_error" };
  }

  try {
    const verify = await supabase
      .from("shipment_items")
      .select("position_id")
      .eq("id", input.shipmentItemId)
      .maybeSingle();
    if (verify.error) return { ok: false, stage: "verify_item_position", reason: verify.error.message };
    if ((verify.data?.position_id as string | undefined) !== input.positionId) {
      return { ok: false, stage: "verify_item_position", reason: "shipment_item_position_not_persisted" };
    }
  } catch (e) {
    return { ok: false, stage: "verify_item_position", reason: (e as Error).message ?? "unknown_error" };
  }
  return { ok: true };
}



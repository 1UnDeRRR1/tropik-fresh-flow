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

async function resolveProductId(name: string): Promise<string | null> {
  const n = name.trim();
  if (!n) return null;
  const { data, error } = await supabase.rpc("rpc_resolve_product_exact", {
    p_query: n,
    // Runtime birth-flow MUST NOT pull frozen-reserve products into the
    // operational dictionary anchor. See POSITION_ID core rule.
    p_include_reserve: false,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  if (!row || row.status !== "matched" || !row.dictionary_id) return null;
  return row.dictionary_id as string;
}

async function resolveCountryId(name: string): Promise<string | null> {
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


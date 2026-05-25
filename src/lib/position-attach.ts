// Position anchor wiring for new manager_offers rows.
// Best-effort: if product/country can't be resolved against dictionaries,
// we leave manager_offers.position_id = NULL and let legacy paths apply.
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
  | { attached: false; reason: string };

async function resolveProductId(name: string): Promise<string | null> {
  const n = name.trim();
  if (!n) return null;
  // 1. Direct dictionary name match (case-insensitive).
  const direct = await supabase
    .from("product_dictionary")
    .select("id")
    .ilike("product_name_ua", n)
    .limit(1)
    .maybeSingle();
  if (direct.data?.id) return direct.data.id as string;
  // 2. Alias → canonical_product_id → dictionary row.
  const alias = await supabase
    .from("product_aliases")
    .select("canonical_product_id")
    .ilike("alias", n)
    .limit(1)
    .maybeSingle();
  const canonical = (alias.data as { canonical_product_id?: string } | null)
    ?.canonical_product_id;
  if (!canonical) return null;
  const byCanonical = await supabase
    .from("product_dictionary")
    .select("id")
    .eq("canonical_product_id", canonical)
    .limit(1)
    .maybeSingle();
  return (byCanonical.data?.id as string | undefined) ?? null;
}

async function resolveCountryId(name: string): Promise<string | null> {
  const n = name.trim();
  if (!n) return null;
  const r = await supabase
    .from("countries")
    .select("id")
    .ilike("name", n)
    .limit(1)
    .maybeSingle();
  return (r.data?.id as string | undefined) ?? null;
}

/**
 * Best-effort: create operational_position (draft) and attach the offer.
 * - Does not overwrite an existing manager_offers.position_id.
 * - Idempotent via source_context/source_row_key keyed to offer id.
 * - On any non-critical failure, returns { attached: false, reason } and the
 *   caller MUST NOT roll back the manager_offers insert — legacy path will
 *   continue to work because manager_offers.position_id stays NULL.
 */
export async function attachOfferToPosition(
  input: AttachInput,
): Promise<AttachResult> {
  try {
    const [productId, countryId] = await Promise.all([
      resolveProductId(input.productName),
      resolveCountryId(input.originCountry),
    ]);
    if (!productId || !countryId) {
      return { attached: false, reason: "product_or_country_not_in_dictionary" };
    }

    const { data: draft, error: draftErr } = await supabase.rpc(
      "rpc_position_create_draft",
      {
        p_product_id: productId,
        p_product_origin_country_id: countryId,
        p_source_context: "manager_offer",
        p_source_row_key: input.offerId,
        p_client_row_id: input.offerId,
        p_caliber: input.caliber ?? null,
        p_package_used: input.packaging ?? null,
        p_responsible_manager_id: input.responsibleManagerId ?? null,
      },
    );
    if (draftErr) return { attached: false, reason: draftErr.message };
    const positionId = Array.isArray(draft) ? draft[0]?.position_id : null;
    if (!positionId) return { attached: false, reason: "no_position_id_returned" };

    const { error: attachErr } = await supabase.rpc(
      "rpc_position_attach_offer",
      {
        p_offer_id: input.offerId,
        p_position_id: positionId,
        p_responsible_manager_id: input.responsibleManagerId ?? null,
      },
    );
    if (attachErr) return { attached: false, reason: attachErr.message };
    return { attached: true, positionId };
  } catch (e) {
    return { attached: false, reason: (e as Error).message ?? "unknown_error" };
  }
}

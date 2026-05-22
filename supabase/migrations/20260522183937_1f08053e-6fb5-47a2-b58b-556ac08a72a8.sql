CREATE OR REPLACE FUNCTION public.rpc_resolve_offer_line_defaults(
  p_product_query text,
  p_country_query text,
  p_package_used text DEFAULT NULL,
  p_include_reserve boolean DEFAULT false
)
RETURNS TABLE(
  status text,
  product_dictionary_id uuid,
  canonical_product_id text,
  product_name_ua text,
  product_match_status text,
  product_candidate_count integer,
  country_name text,
  country_iso3 text,
  country_match_status text,
  pallet_standard_id uuid,
  package_used text,
  pallet_net_kg numeric,
  pallet_gross_kg numeric,
  pallet_footprint_text text,
  pallet_selected_by text,
  pallet_candidate_count integer,
  needs_review boolean,
  review_reason text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_p record;
  v_c record;
  v_pl record;
BEGIN
  -- Product resolution
  SELECT * INTO v_p
  FROM public.rpc_resolve_product_exact(p_product_query, p_include_reserve)
  LIMIT 1;

  IF v_p IS NULL OR v_p.status = 'no_match' THEN
    RETURN QUERY SELECT
      'product_no_match'::text, NULL::uuid, NULL::text, NULL::text,
      COALESCE(v_p.status, 'no_match')::text, COALESCE(v_p.candidate_count, 0)::integer,
      NULL::text, NULL::text, NULL::text,
      NULL::uuid, NULL::text, NULL::numeric, NULL::numeric, NULL::text, NULL::text, NULL::integer,
      false, 'product_no_match'::text;
    RETURN;
  END IF;

  IF v_p.status = 'ambiguous' THEN
    RETURN QUERY SELECT
      'product_ambiguous'::text, NULL::uuid, NULL::text, NULL::text,
      v_p.status::text, v_p.candidate_count::integer,
      NULL::text, NULL::text, NULL::text,
      NULL::uuid, NULL::text, NULL::numeric, NULL::numeric, NULL::text, NULL::text, NULL::integer,
      false, 'product_ambiguous'::text;
    RETURN;
  END IF;

  -- Country resolution
  SELECT * INTO v_c
  FROM public.rpc_resolve_country(p_country_query)
  LIMIT 1;

  IF v_c IS NULL OR v_c.status <> 'matched' THEN
    RETURN QUERY SELECT
      'country_no_match'::text, v_p.dictionary_id, v_p.canonical_product_id, v_p.product_name_ua,
      v_p.status::text, v_p.candidate_count::integer,
      NULL::text, NULL::text, COALESCE(v_c.status, 'no_match')::text,
      NULL::uuid, NULL::text, NULL::numeric, NULL::numeric, NULL::text, NULL::text, NULL::integer,
      false, 'country_no_match'::text;
    RETURN;
  END IF;

  -- Pallet resolution
  SELECT * INTO v_pl
  FROM public.rpc_pallet_standard_exact(v_p.dictionary_id, v_c.country_name, p_package_used)
  LIMIT 1;

  IF v_pl IS NULL OR v_pl.status = 'no_match' OR v_pl.needs_review IS TRUE THEN
    RETURN QUERY SELECT
      'pallet_no_match'::text, v_p.dictionary_id, v_p.canonical_product_id, v_p.product_name_ua,
      v_p.status::text, v_p.candidate_count::integer,
      v_c.country_name, v_c.iso3, v_c.status::text,
      NULL::uuid, NULL::text, NULL::numeric, NULL::numeric, NULL::text, NULL::text,
      COALESCE(v_pl.candidate_count, 0)::integer,
      COALESCE(v_pl.needs_review, false),
      CASE WHEN v_pl.needs_review IS TRUE THEN 'pallet_needs_review' ELSE 'pallet_no_match' END::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    'matched'::text, v_p.dictionary_id, v_p.canonical_product_id, v_p.product_name_ua,
    v_p.status::text, v_p.candidate_count::integer,
    v_c.country_name, v_c.iso3, v_c.status::text,
    v_pl.pallet_standard_id, v_pl.package_used, v_pl.pallet_net_kg, v_pl.pallet_gross_kg,
    v_pl.pallet_footprint_text, v_pl.selected_by, v_pl.candidate_count,
    false, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_resolve_offer_line_defaults(text, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_resolve_offer_line_defaults(text, text, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_resolve_offer_line_defaults(text, text, text, boolean) TO authenticated;
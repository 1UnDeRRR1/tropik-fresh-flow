
-- Fix country resolver: case-insensitive join
CREATE OR REPLACE FUNCTION public.rpc_resolve_country(p_query text)
RETURNS TABLE (
  status            text,
  country_name      text,
  iso2              text,
  iso3              text,
  alias_normalized  text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_q text := fn_normalize_text(p_query);
BEGIN
  IF v_q IS NULL OR v_q = '' THEN
    RETURN QUERY SELECT 'no_match'::text, NULL::text, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT 'matched'::text,
         c.name,
         c.code,
         NULL::text,
         ca.alias_normalized
  FROM country_aliases ca
  JOIN countries c ON fn_normalize_text(c.name) = fn_normalize_text(ca.country_name)
  WHERE ca.alias_normalized = v_q
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'no_match'::text, NULL::text, NULL::text, NULL::text, NULL::text;
  END IF;
END;
$$;

-- Also: pallet resolver's accepted-set join must be case-insensitive too
CREATE OR REPLACE FUNCTION public.rpc_pallet_standard_exact(
  p_dictionary_id uuid,
  p_country       text,
  p_package_used  text DEFAULT NULL
)
RETURNS TABLE (
  status                text,
  pallet_standard_id    uuid,
  canonical_product_id  text,
  package_used          text,
  pallet_footprint_text text,
  pallet_net_kg         numeric,
  pallet_gross_kg       numeric,
  mapping_status        text,
  needs_review          boolean,
  match_kind            text,
  selected_by           text,
  candidate_count       integer
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_canonical_id text;
  v_country_name text;
  v_count        integer;
  v_pkg_norm     text;
BEGIN
  SELECT pd.canonical_product_id INTO v_canonical_id
  FROM product_dictionary pd
  WHERE pd.id = p_dictionary_id;

  IF v_canonical_id IS NULL THEN
    RETURN QUERY SELECT 'no_match'::text, NULL::uuid, NULL::text, NULL::text, NULL::text,
                        NULL::numeric, NULL::numeric, NULL::text, NULL::boolean,
                        'exact'::text, NULL::text, 0;
    RETURN;
  END IF;

  SELECT r.country_name INTO v_country_name
  FROM rpc_resolve_country(p_country) r
  WHERE r.status = 'matched';

  IF v_country_name IS NULL THEN
    RETURN QUERY SELECT 'no_match'::text, NULL::uuid, v_canonical_id, NULL::text, NULL::text,
                        NULL::numeric, NULL::numeric, NULL::text, NULL::boolean,
                        'exact'::text, NULL::text, 0;
    RETURN;
  END IF;

  v_pkg_norm := CASE WHEN p_package_used IS NOT NULL
                     THEN fn_normalize_text(p_package_used) END;

  WITH accepted AS (
    SELECT ca.alias_normalized AS lbl
    FROM country_aliases ca
    WHERE fn_normalize_text(ca.country_name) = fn_normalize_text(v_country_name)
    UNION
    SELECT fn_normalize_text(c.name) FROM countries c
      WHERE fn_normalize_text(c.name) = fn_normalize_text(v_country_name)
    UNION
    SELECT fn_normalize_text(c.code) FROM countries c
      WHERE fn_normalize_text(c.name) = fn_normalize_text(v_country_name) AND c.code IS NOT NULL
  ),
  cand AS (
    SELECT ps.*
    FROM pallet_standards ps
    WHERE ps.canonical_product_id = v_canonical_id
      AND ps.mapping_status = 'matched'
      AND ps.needs_review = false
      AND ps.package_used IS NOT NULL
      AND (
        fn_normalize_text(ps.country_en) IN (SELECT lbl FROM accepted)
        OR fn_normalize_text(ps.country_ru) IN (SELECT lbl FROM accepted)
      )
  )
  SELECT count(*) INTO v_count FROM cand;

  IF v_count = 0 THEN
    RETURN QUERY SELECT 'no_match'::text, NULL::uuid, v_canonical_id, NULL::text, NULL::text,
                        NULL::numeric, NULL::numeric, NULL::text, NULL::boolean,
                        'exact'::text, NULL::text, 0;
    RETURN;
  END IF;

  RETURN QUERY
  WITH accepted AS (
    SELECT ca.alias_normalized AS lbl
    FROM country_aliases ca
    WHERE fn_normalize_text(ca.country_name) = fn_normalize_text(v_country_name)
    UNION
    SELECT fn_normalize_text(c.name) FROM countries c
      WHERE fn_normalize_text(c.name) = fn_normalize_text(v_country_name)
    UNION
    SELECT fn_normalize_text(c.code) FROM countries c
      WHERE fn_normalize_text(c.name) = fn_normalize_text(v_country_name) AND c.code IS NOT NULL
  ),
  cand AS (
    SELECT ps.*
    FROM pallet_standards ps
    WHERE ps.canonical_product_id = v_canonical_id
      AND ps.mapping_status = 'matched'
      AND ps.needs_review = false
      AND ps.package_used IS NOT NULL
      AND (
        fn_normalize_text(ps.country_en) IN (SELECT lbl FROM accepted)
        OR fn_normalize_text(ps.country_ru) IN (SELECT lbl FROM accepted)
      )
  ),
  explicit_pick AS (
    SELECT c.*, 'explicit_package'::text AS sel
    FROM cand c
    WHERE v_pkg_norm IS NOT NULL
      AND fn_normalize_text(c.package_used) = v_pkg_norm
    ORDER BY c.pallet_gross_kg DESC NULLS LAST,
             c.pallet_net_kg   DESC NULLS LAST,
             c.package_used    ASC  NULLS LAST,
             c.id              ASC
    LIMIT 1
  ),
  default_pick AS (
    SELECT c.*,
           CASE WHEN v_count = 1 THEN 'exact_single'
                ELSE 'heaviest_gross_default' END AS sel
    FROM cand c
    ORDER BY c.pallet_gross_kg DESC NULLS LAST,
             c.pallet_net_kg   DESC NULLS LAST,
             c.package_used    ASC  NULLS LAST,
             c.id              ASC
    LIMIT 1
  ),
  chosen AS (
    SELECT * FROM explicit_pick
    UNION ALL
    SELECT * FROM default_pick WHERE NOT EXISTS (SELECT 1 FROM explicit_pick)
    LIMIT 1
  )
  SELECT
    'matched'::text,
    ch.id,
    ch.canonical_product_id,
    ch.package_used,
    concat_ws(' / ', ch.pallet_size, ch.pallet_type)::text,
    ch.pallet_net_kg,
    ch.pallet_gross_kg,
    ch.mapping_status,
    ch.needs_review,
    'exact'::text,
    ch.sel,
    v_count
  FROM chosen ch;
END;
$$;

-- Revoke EXECUTE from anon (Supabase default-grants it)
REVOKE EXECUTE ON FUNCTION public.fn_normalize_text(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rpc_resolve_product_search(text, integer, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rpc_resolve_product_exact(text, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rpc_resolve_country(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rpc_pallet_standard_exact(uuid, text, text) FROM anon;

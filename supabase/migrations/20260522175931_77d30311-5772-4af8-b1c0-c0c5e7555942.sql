
-- =========================================================
-- Patch 9B: read-only resolver layer (functions only)
-- No table/column/schema changes. No triggers. No policies.
-- =========================================================

-- 1. Normalization helper
CREATE OR REPLACE FUNCTION public.fn_normalize_text(p_in text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_in IS NULL THEN NULL
    ELSE regexp_replace(btrim(lower(p_in)), '\s+', ' ', 'g')
  END;
$$;

REVOKE ALL ON FUNCTION public.fn_normalize_text(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_normalize_text(text) TO authenticated;


-- 2. Product search resolver (exact_alias + prefix_alias)
CREATE OR REPLACE FUNCTION public.rpc_resolve_product_search(
  p_query           text,
  p_limit           integer DEFAULT 20,
  p_include_reserve boolean DEFAULT false
)
RETURNS TABLE (
  dictionary_id         uuid,
  canonical_product_id  text,
  product_key           text,
  product_name_ua       text,
  product_name_en       text,
  matched_alias         text,
  alias_normalized      text,
  match_language        text,
  is_working_assortment boolean,
  match_type            text,
  match_rank            integer
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
    RETURN;
  END IF;

  RETURN QUERY
  WITH alias_src AS (
    -- explicit aliases
    SELECT pa.canonical_product_id,
           pa.alias            AS matched_alias,
           pa.alias_normalized AS alias_normalized,
           pa.language_hint    AS match_language
    FROM product_aliases pa
    WHERE pa.mapping_status = 'matched'
    UNION ALL
    -- canonical UA name
    SELECT pd.canonical_product_id,
           pd.product_name_ua,
           fn_normalize_text(pd.product_name_ua),
           'uk'
    FROM product_dictionary pd
    WHERE pd.product_name_ua IS NOT NULL
    UNION ALL
    -- canonical EN name
    SELECT pd.canonical_product_id,
           pd.product_name_en,
           fn_normalize_text(pd.product_name_en),
           'en'
    FROM product_dictionary pd
    WHERE pd.product_name_en IS NOT NULL
  ),
  scored AS (
    SELECT a.canonical_product_id,
           a.matched_alias,
           a.alias_normalized,
           a.match_language,
           CASE
             WHEN a.alias_normalized = v_q              THEN 'exact_alias'
             WHEN a.alias_normalized LIKE v_q || '%'    THEN 'prefix_alias'
             ELSE NULL
           END AS match_type,
           CASE
             WHEN a.alias_normalized = v_q              THEN 1
             WHEN a.alias_normalized LIKE v_q || '%'    THEN 2
             ELSE 99
           END AS match_rank
    FROM alias_src a
  ),
  filtered AS (
    SELECT DISTINCT ON (s.canonical_product_id)
           s.canonical_product_id,
           s.matched_alias,
           s.alias_normalized,
           s.match_language,
           s.match_type,
           s.match_rank
    FROM scored s
    WHERE s.match_type IS NOT NULL
    ORDER BY s.canonical_product_id, s.match_rank, length(s.alias_normalized)
  )
  SELECT
    pd.id,
    pd.canonical_product_id,
    pd.product_key,
    pd.product_name_ua,
    pd.product_name_en,
    f.matched_alias,
    f.alias_normalized,
    f.match_language,
    pd.is_working_assortment,
    f.match_type,
    f.match_rank
  FROM filtered f
  JOIN product_dictionary pd ON pd.canonical_product_id = f.canonical_product_id
  WHERE (p_include_reserve OR pd.is_working_assortment = true)
  ORDER BY f.match_rank, pd.is_working_assortment DESC, pd.product_name_ua
  LIMIT GREATEST(COALESCE(p_limit, 20), 1);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_resolve_product_search(text, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_resolve_product_search(text, integer, boolean) TO authenticated;


-- 3. Product exact resolver
CREATE OR REPLACE FUNCTION public.rpc_resolve_product_exact(
  p_query           text,
  p_include_reserve boolean DEFAULT true
)
RETURNS TABLE (
  status               text,
  dictionary_id        uuid,
  canonical_product_id text,
  product_name_ua      text,
  candidate_count      integer
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_q text := fn_normalize_text(p_query);
  v_count integer;
BEGIN
  IF v_q IS NULL OR v_q = '' THEN
    RETURN QUERY SELECT 'no_match'::text, NULL::uuid, NULL::text, NULL::text, 0;
    RETURN;
  END IF;

  WITH matched_ids AS (
    SELECT DISTINCT pa.canonical_product_id
    FROM product_aliases pa
    WHERE pa.mapping_status = 'matched'
      AND pa.alias_normalized = v_q
    UNION
    SELECT pd.canonical_product_id
    FROM product_dictionary pd
    WHERE fn_normalize_text(pd.product_name_ua) = v_q
       OR fn_normalize_text(pd.product_name_en) = v_q
  ),
  dict AS (
    SELECT pd.*
    FROM product_dictionary pd
    JOIN matched_ids m ON m.canonical_product_id = pd.canonical_product_id
    WHERE (p_include_reserve OR pd.is_working_assortment = true)
  )
  SELECT count(*) INTO v_count FROM dict;

  IF v_count = 0 THEN
    RETURN QUERY SELECT 'no_match'::text, NULL::uuid, NULL::text, NULL::text, 0;
  ELSIF v_count = 1 THEN
    RETURN QUERY
    WITH matched_ids AS (
      SELECT DISTINCT pa.canonical_product_id
      FROM product_aliases pa
      WHERE pa.mapping_status = 'matched' AND pa.alias_normalized = v_q
      UNION
      SELECT pd.canonical_product_id
      FROM product_dictionary pd
      WHERE fn_normalize_text(pd.product_name_ua) = v_q
         OR fn_normalize_text(pd.product_name_en) = v_q
    )
    SELECT 'matched'::text, pd.id, pd.canonical_product_id, pd.product_name_ua, 1
    FROM product_dictionary pd
    JOIN matched_ids m ON m.canonical_product_id = pd.canonical_product_id
    WHERE (p_include_reserve OR pd.is_working_assortment = true)
    LIMIT 1;
  ELSE
    RETURN QUERY SELECT 'ambiguous'::text, NULL::uuid, NULL::text, NULL::text, v_count;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_resolve_product_exact(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_resolve_product_exact(text, boolean) TO authenticated;


-- 4. Country resolver (exact normalized alias)
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
  JOIN countries c ON c.name = ca.country_name
  WHERE ca.alias_normalized = v_q
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'no_match'::text, NULL::text, NULL::text, NULL::text, NULL::text;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_resolve_country(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_resolve_country(text) TO authenticated;


-- 5. Pallet standard exact resolver (heaviest-gross default)
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
    WHERE ca.country_name = v_country_name
    UNION
    SELECT fn_normalize_text(c.name) FROM countries c WHERE c.name = v_country_name
    UNION
    SELECT fn_normalize_text(c.code) FROM countries c
      WHERE c.name = v_country_name AND c.code IS NOT NULL
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
    WHERE ca.country_name = v_country_name
    UNION
    SELECT fn_normalize_text(c.name) FROM countries c WHERE c.name = v_country_name
    UNION
    SELECT fn_normalize_text(c.code) FROM countries c
      WHERE c.name = v_country_name AND c.code IS NOT NULL
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

REVOKE ALL ON FUNCTION public.rpc_pallet_standard_exact(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_pallet_standard_exact(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_pallet_standard_resolve(
  p_dictionary_id uuid,
  p_country       text
)
RETURNS TABLE (
  match_type                  text,
  is_fallback                 boolean,
  fallback_explanation        text,
  selected_pallet_standard_id uuid,
  selected_package_used       text,
  selected_pallet_net_kg      numeric,
  selected_pallet_gross_kg    numeric,
  options                     jsonb,
  product_dictionary_id       uuid,
  canonical_product_id        text,
  product_name_ua             text,
  country_name                text
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_canonical_id  text;
  v_product_ua    text;
  v_country_name  text;
  v_country_forms text[];
  v_match_type    text := 'no_match';
  v_explanation   text := NULL;
  v_rows          jsonb := '[]'::jsonb;
BEGIN
  SELECT pd.canonical_product_id, pd.product_name_ua
    INTO v_canonical_id, v_product_ua
  FROM product_dictionary pd
  WHERE pd.id = p_dictionary_id;

  IF v_canonical_id IS NULL AND v_product_ua IS NULL THEN
    RETURN QUERY SELECT 'no_match'::text, false, 'product not found'::text,
      NULL::uuid, NULL::text, NULL::numeric, NULL::numeric,
      '[]'::jsonb, p_dictionary_id, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF p_country IS NOT NULL AND length(btrim(p_country)) > 0 THEN
    SELECT r.country_name INTO v_country_name
    FROM rpc_resolve_country(p_country) r
    WHERE r.status = 'matched'
    LIMIT 1;
  END IF;

  IF v_country_name IS NOT NULL THEN
    SELECT array_agg(DISTINCT lower(btrim(x)))
      INTO v_country_forms
    FROM (
      SELECT v_country_name AS x
      UNION ALL
      SELECT alias FROM country_aliases WHERE country_name = v_country_name
    ) s
    WHERE x IS NOT NULL AND length(btrim(x)) > 0;
  ELSE
    v_country_forms := ARRAY[]::text[];
  END IF;

  WITH ps AS (
    SELECT *
    FROM pallet_standards p
    WHERE (v_canonical_id IS NOT NULL AND p.canonical_product_id = v_canonical_id)
       OR (v_product_ua   IS NOT NULL AND p.product_label = v_product_ua)
  ),
  classified AS (
    SELECT
      ps.*,
      CASE
        WHEN v_country_name IS NOT NULL AND (
             lower(btrim(ps.country_en)) = ANY (v_country_forms)
          OR lower(btrim(ps.country_ru)) = ANY (v_country_forms)
        ) THEN 'exact'

        WHEN v_country_name IS NOT NULL AND (
          (ps.country_en LIKE '%/%' AND EXISTS (
             SELECT 1 FROM unnest(string_to_array(ps.country_en, '/')) frag
             WHERE lower(btrim(frag)) = ANY (v_country_forms)
          ))
          OR
          (ps.country_ru LIKE '%/%' AND EXISTS (
             SELECT 1 FROM unnest(string_to_array(ps.country_ru, '/')) frag
             WHERE lower(btrim(frag)) = ANY (v_country_forms)
          ))
        ) THEN 'compound_group'

        WHEN lower(btrim(coalesce(ps.country_en,''))) IN ('all','all origins average','any origin')
          OR lower(btrim(coalesce(ps.country_ru,''))) IN ('усі країни','все страны','any origin','all origins average')
        THEN 'all_fallback'

        ELSE 'other'
      END AS row_match_type
    FROM ps
  ),
  best AS (
    SELECT row_match_type AS mt
    FROM classified
    WHERE row_match_type IN ('exact','compound_group','all_fallback')
    ORDER BY CASE row_match_type
               WHEN 'exact' THEN 1
               WHEN 'compound_group' THEN 2
               WHEN 'all_fallback' THEN 3
             END
    LIMIT 1
  )
  SELECT
    COALESCE((SELECT mt FROM best), 'no_match'),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'package_used', c.package_used,
          'pallet_size', c.pallet_size,
          'pallet_net_kg', c.pallet_net_kg,
          'pallet_gross_kg', c.pallet_gross_kg,
          'country_en', c.country_en,
          'country_ru', c.country_ru,
          'match_type', c.row_match_type,
          'is_fallback', (c.row_match_type <> 'exact')
        )
        ORDER BY c.pallet_gross_kg DESC NULLS LAST
      ) FILTER (
        WHERE c.row_match_type = COALESCE((SELECT mt FROM best), 'none')
          AND c.package_used IS NOT NULL
      ),
      '[]'::jsonb
    )
  INTO v_match_type, v_rows
  FROM classified c;

  IF v_match_type = 'compound_group' THEN
    v_explanation := 'Стандарт: compound rows';
  ELSIF v_match_type = 'all_fallback' THEN
    v_explanation := 'Стандарт: загальний стандарт ALL';
  ELSIF v_match_type = 'no_match' THEN
    v_explanation := 'Стандарт не знайдено';
  END IF;

  RETURN QUERY
  SELECT
    v_match_type,
    (v_match_type <> 'exact' AND v_match_type <> 'no_match'),
    v_explanation,
    NULLIF((v_rows -> 0 ->> 'id'), '')::uuid,
    (v_rows -> 0 ->> 'package_used'),
    NULLIF((v_rows -> 0 ->> 'pallet_net_kg'), '')::numeric,
    NULLIF((v_rows -> 0 ->> 'pallet_gross_kg'), '')::numeric,
    v_rows,
    p_dictionary_id,
    v_canonical_id,
    v_product_ua,
    v_country_name;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_pallet_standard_resolve(uuid, text) TO authenticated;
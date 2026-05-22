DROP FUNCTION IF EXISTS public.rpc_resolve_country(text);

CREATE OR REPLACE FUNCTION public.rpc_resolve_country(p_input text)
RETURNS TABLE (
  status            text,
  country_name      text,
  iso3              text,
  alias_normalized  text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $func$
DECLARE
  v_norm text;
BEGIN
  v_norm := public.fn_normalize_text(p_input);

  RETURN QUERY
  SELECT
    'matched'::text,
    h.country_name,
    NULLIF(btrim(h.code), '')::text,
    h.alias_normalized
  FROM (
    SELECT
      ca.country_name,
      ca.alias_normalized,
      c.code
    FROM public.country_aliases ca
    LEFT JOIN public.countries c
      ON lower(c.name) = lower(ca.country_name)
    WHERE ca.alias_normalized = v_norm
    ORDER BY
      (c.code IS NOT NULL AND btrim(c.code) <> '') DESC,
      (lower(c.name) = lower(ca.country_name))     DESC,
      c.name ASC NULLS LAST
    LIMIT 1
  ) h;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'no_match'::text, NULL::text, NULL::text, v_norm;
  END IF;
END;
$func$;

REVOKE ALL ON FUNCTION public.rpc_resolve_country(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_resolve_country(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_resolve_country(text) TO authenticated;
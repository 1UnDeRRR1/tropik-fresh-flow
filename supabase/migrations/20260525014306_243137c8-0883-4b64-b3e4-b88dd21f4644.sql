-- Phase 2: minimal additive schema to represent EU origin + EU membership.
-- No data wipe, no RLS changes, no touch on other tables.

ALTER TABLE public.countries
  ADD COLUMN IF NOT EXISTS is_eu boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS iso2 text,
  ADD COLUMN IF NOT EXISTS iso3 text,
  ADD COLUMN IF NOT EXISTS scope_type text NOT NULL DEFAULT 'country'
    CHECK (scope_type IN ('country','customs_origin_group'));

CREATE UNIQUE INDEX IF NOT EXISTS countries_iso3_unique
  ON public.countries (iso3) WHERE iso3 IS NOT NULL;

ALTER TABLE public.country_aliases
  ADD COLUMN IF NOT EXISTS alias_type text;

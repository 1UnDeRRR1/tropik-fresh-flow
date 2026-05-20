
CREATE TABLE IF NOT EXISTS public.country_aliases (
  id bigserial PRIMARY KEY,
  country_name text NOT NULL,
  alias text NOT NULL,
  alias_normalized text NOT NULL,
  lang text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS country_aliases_norm_idx ON public.country_aliases(alias_normalized);
CREATE UNIQUE INDEX IF NOT EXISTS country_aliases_uniq ON public.country_aliases(alias_normalized, country_name);

ALTER TABLE public.country_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "country_aliases read auth"
  ON public.country_aliases FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "country_aliases write admin"
  ON public.country_aliases FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

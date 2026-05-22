CREATE TABLE public.product_dictionary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_product_id text NOT NULL UNIQUE,
  product_key text NOT NULL UNIQUE,
  product_name_ua text NOT NULL,
  product_name_en text,
  group_code text,
  group_name_ua text,
  group_name_en text,
  source_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  is_working_assortment boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pd_source_product_id ON public.product_dictionary(source_product_id);
CREATE INDEX idx_pd_is_working ON public.product_dictionary(is_working_assortment);

CREATE TABLE public.product_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_product_id text NOT NULL REFERENCES public.product_dictionary(canonical_product_id) ON DELETE CASCADE,
  alias text NOT NULL,
  alias_normalized text NOT NULL,
  language_hint text,
  mapping_status text NOT NULL DEFAULT 'matched',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (canonical_product_id, alias_normalized)
);
CREATE INDEX idx_pa_alias_norm ON public.product_aliases(alias_normalized);
CREATE INDEX idx_pa_canonical ON public.product_aliases(canonical_product_id);

CREATE TABLE public.pallet_standards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_label text NOT NULL,
  country_ru text,
  country_en text,
  region text,
  pallet_size text,
  pallet_type text,
  package_used text NOT NULL,
  boxes_per_pallet integer,
  box_net_kg numeric,
  box_gross_kg numeric,
  pallet_net_kg numeric,
  pallet_gross_kg numeric,
  confidence text,
  source_basis text,
  comment text,
  check_note text,
  canonical_product_id text REFERENCES public.product_dictionary(canonical_product_id) ON DELETE SET NULL,
  mapping_status text NOT NULL DEFAULT 'matched',
  needs_review boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ps_canonical ON public.pallet_standards(canonical_product_id);
CREATE INDEX idx_ps_label ON public.pallet_standards(product_label);

ALTER TABLE public.product_dictionary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pallet_standards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_dictionary read auth" ON public.product_dictionary FOR SELECT TO authenticated USING (true);
CREATE POLICY "product_aliases read auth"   ON public.product_aliases   FOR SELECT TO authenticated USING (true);
CREATE POLICY "pallet_standards read auth"  ON public.pallet_standards  FOR SELECT TO authenticated USING (true);

REVOKE INSERT, UPDATE, DELETE ON public.product_dictionary FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.product_aliases   FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.pallet_standards  FROM authenticated, anon, PUBLIC;

GRANT SELECT ON public.product_dictionary TO authenticated;
GRANT SELECT ON public.product_aliases   TO authenticated;
GRANT SELECT ON public.pallet_standards  TO authenticated;
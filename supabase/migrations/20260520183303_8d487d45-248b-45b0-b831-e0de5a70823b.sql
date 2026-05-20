CREATE TABLE IF NOT EXISTS public.product_varieties (
  id BIGSERIAL PRIMARY KEY,
  product_name_ua TEXT NOT NULL,
  product_name_en TEXT,
  group_name TEXT,
  variety TEXT NOT NULL,
  variety_normalized TEXT GENERATED ALWAYS AS (lower(variety)) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_varieties_product_ua
  ON public.product_varieties (lower(product_name_ua));
CREATE INDEX IF NOT EXISTS idx_product_varieties_product_en
  ON public.product_varieties (lower(product_name_en));
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_varieties_product_variety
  ON public.product_varieties (lower(product_name_ua), lower(variety));

ALTER TABLE public.product_varieties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_varieties read auth"
  ON public.product_varieties FOR SELECT TO authenticated USING (true);

CREATE POLICY "product_varieties write admin"
  ON public.product_varieties FOR ALL TO authenticated
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));
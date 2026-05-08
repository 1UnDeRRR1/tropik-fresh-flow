CREATE TABLE public.loading_plan (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_name text NOT NULL,
  caliber text,
  country text,
  planned_pallets numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.loading_plan ENABLE ROW LEVEL SECURITY;

CREATE POLICY "loading_plan read auth"
  ON public.loading_plan FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "loading_plan write admin"
  ON public.loading_plan FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE TRIGGER trg_loading_plan_updated
  BEFORE UPDATE ON public.loading_plan
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX idx_loading_plan_active ON public.loading_plan(is_active);
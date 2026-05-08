-- Customs reference table
CREATE TABLE public.customs_reference (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name text NOT NULL,
  country text NOT NULL,
  threshold_price_usd numeric NOT NULL DEFAULT 0,
  customs_fee_percent numeric NOT NULL DEFAULT 0,
  euro1_markup_usd numeric NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX customs_reference_active_uniq
  ON public.customs_reference (lower(product_name), lower(country))
  WHERE active = true;

ALTER TABLE public.customs_reference ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customs_ref read auth" ON public.customs_reference
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "customs_ref write admin" ON public.customs_reference
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE TRIGGER trg_customs_ref_touch
  BEFORE UPDATE ON public.customs_reference
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Computed cost columns on shipment_items
ALTER TABLE public.shipment_items
  ADD COLUMN IF NOT EXISTS customs_match_id uuid,
  ADD COLUMN IF NOT EXISTS customs_cost_indicative numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customs_cost_invoice numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_cost_indicative numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_cost_invoice numeric DEFAULT 0;

-- Calculation function
CREATE OR REPLACE FUNCTION public.calc_shipment_item_costs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ship_country text;
  ship_log_usd numeric;
  ref_row public.customs_reference%ROWTYPE;
  unit_usd numeric;
  vat_part numeric;
  result2 numeric;
  customs_fee numeric;
  total_weight numeric;
  transport_per_kg numeric := 0;
BEGIN
  SELECT country, COALESCE(logistics_cost_usd, 0)
    INTO ship_country, ship_log_usd
    FROM public.shipments WHERE id = NEW.shipment_id;

  -- Find matching customs reference (case-insensitive, country match, active)
  SELECT * INTO ref_row FROM public.customs_reference
   WHERE active = true
     AND lower(product_name) = lower(COALESCE(NEW.product_name, ''))
     AND lower(country) = lower(COALESCE(ship_country, ''))
   LIMIT 1;

  unit_usd := COALESCE(NEW.unit_price_usd, 0);

  IF ref_row.id IS NULL THEN
    NEW.customs_match_id := NULL;
    NEW.customs_cost_indicative := 0;
    NEW.customs_cost_invoice := 0;
  ELSE
    NEW.customs_match_id := ref_row.id;
    NEW.customs_cost_indicative := ref_row.euro1_markup_usd;
    IF unit_usd <= ref_row.threshold_price_usd THEN
      NEW.customs_cost_invoice := ref_row.euro1_markup_usd;
    ELSE
      vat_part := unit_usd * 0.20;
      result2 := unit_usd + vat_part;
      customs_fee := result2 * COALESCE(ref_row.customs_fee_percent, 0) / 100.0;
      NEW.customs_cost_invoice := vat_part + customs_fee + 0.015;
    END IF;
  END IF;

  -- Approx transport per kg from shipment-level snapshot
  SELECT COALESCE(SUM(COALESCE(pallet_count,0) * COALESCE(pallet_weight,0)), 0)
    INTO total_weight FROM public.shipment_items WHERE shipment_id = NEW.shipment_id;
  IF total_weight > 0 THEN
    transport_per_kg := ship_log_usd / total_weight;
  END IF;

  NEW.final_cost_indicative := unit_usd + transport_per_kg + COALESCE(NEW.customs_cost_indicative, 0);
  NEW.final_cost_invoice := unit_usd + transport_per_kg + COALESCE(NEW.customs_cost_invoice, 0);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_calc_shipment_item_costs ON public.shipment_items;
CREATE TRIGGER trg_calc_shipment_item_costs
  BEFORE INSERT OR UPDATE OF unit_price_usd, unit_price, price_currency, product_name, pallet_count, pallet_weight
  ON public.shipment_items
  FOR EACH ROW EXECUTE FUNCTION public.calc_shipment_item_costs();

-- Recompute children when shipment country or logistics changes
CREATE OR REPLACE FUNCTION public.recompute_shipment_items_costs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.country IS DISTINCT FROM OLD.country
     OR NEW.logistics_cost_usd IS DISTINCT FROM OLD.logistics_cost_usd THEN
    UPDATE public.shipment_items
       SET updated_at = updated_at  -- triggers BEFORE UPDATE recompute
     WHERE shipment_id = NEW.id;
    -- Force recompute via no-op update on a calc-relevant column
    UPDATE public.shipment_items
       SET unit_price_usd = unit_price_usd
     WHERE shipment_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recompute_shipment_items_costs ON public.shipments;
CREATE TRIGGER trg_recompute_shipment_items_costs
  AFTER UPDATE OF country, logistics_cost_usd ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.recompute_shipment_items_costs();
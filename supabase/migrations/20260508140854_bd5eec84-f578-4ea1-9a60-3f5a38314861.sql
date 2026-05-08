
-- Exchange rates table
CREATE TABLE public.exchange_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_currency text NOT NULL DEFAULT 'EUR',
  target_currency text NOT NULL DEFAULT 'USD',
  rate numeric NOT NULL,
  source text NOT NULL DEFAULT 'frankfurter',
  rate_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (base_currency, target_currency, rate_date)
);
ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fx read auth" ON public.exchange_rates FOR SELECT TO authenticated USING (true);
CREATE POLICY "fx insert staff" ON public.exchange_rates FOR INSERT TO authenticated WITH CHECK (is_staff(auth.uid()));
CREATE INDEX idx_exchange_rates_date ON public.exchange_rates (base_currency, target_currency, rate_date DESC);

-- Shipment-level snapshot
ALTER TABLE public.shipments
  ADD COLUMN logistics_cost_currency text NOT NULL DEFAULT 'EUR',
  ADD COLUMN logistics_cost_usd numeric DEFAULT 0,
  ADD COLUMN eur_usd_rate numeric,
  ADD COLUMN eur_usd_rate_date date;

-- Shipment item per-row currency snapshot
ALTER TABLE public.shipment_items
  ADD COLUMN price_currency text NOT NULL DEFAULT 'EUR',
  ADD COLUMN unit_price_usd numeric DEFAULT 0,
  ADD COLUMN fx_rate_used numeric;

-- Trigger: ensure shipment has eur_usd_rate snapshot if any EUR value is saved
CREATE OR REPLACE FUNCTION public.ensure_shipment_fx_snapshot(_shipment_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_rate numeric;
  latest numeric;
  latest_date date;
BEGIN
  SELECT eur_usd_rate INTO current_rate FROM public.shipments WHERE id = _shipment_id;
  IF current_rate IS NOT NULL THEN
    RETURN current_rate;
  END IF;
  SELECT rate, rate_date INTO latest, latest_date
  FROM public.exchange_rates
  WHERE base_currency='EUR' AND target_currency='USD'
  ORDER BY rate_date DESC LIMIT 1;
  IF latest IS NULL THEN
    latest := 1.08;
    latest_date := CURRENT_DATE;
  END IF;
  UPDATE public.shipments
    SET eur_usd_rate = latest, eur_usd_rate_date = latest_date
    WHERE id = _shipment_id;
  RETURN latest;
END;
$$;

-- Trigger function for shipment_items: compute USD snapshot
CREATE OR REPLACE FUNCTION public.calc_shipment_item_usd()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rate numeric;
BEGIN
  IF NEW.price_currency = 'USD' THEN
    NEW.fx_rate_used := 1;
    NEW.unit_price_usd := COALESCE(NEW.unit_price, 0);
  ELSE
    rate := public.ensure_shipment_fx_snapshot(NEW.shipment_id);
    NEW.fx_rate_used := rate;
    NEW.unit_price_usd := COALESCE(NEW.unit_price, 0) * rate;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_shipment_item_usd
  BEFORE INSERT OR UPDATE OF unit_price, price_currency
  ON public.shipment_items
  FOR EACH ROW EXECUTE FUNCTION public.calc_shipment_item_usd();

-- Trigger function for shipments: compute logistics_cost_usd
CREATE OR REPLACE FUNCTION public.calc_shipment_logistics_usd()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rate numeric;
  latest numeric;
  latest_date date;
BEGIN
  IF NEW.logistics_cost_currency = 'USD' THEN
    NEW.logistics_cost_usd := COALESCE(NEW.logistics_cost, 0);
  ELSE
    -- Need a shipment fx snapshot
    IF NEW.eur_usd_rate IS NULL THEN
      SELECT rate, rate_date INTO latest, latest_date
      FROM public.exchange_rates
      WHERE base_currency='EUR' AND target_currency='USD'
      ORDER BY rate_date DESC LIMIT 1;
      IF latest IS NULL THEN
        latest := 1.08;
        latest_date := CURRENT_DATE;
      END IF;
      NEW.eur_usd_rate := latest;
      NEW.eur_usd_rate_date := latest_date;
    END IF;
    rate := NEW.eur_usd_rate;
    NEW.logistics_cost_usd := COALESCE(NEW.logistics_cost, 0) * rate;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_shipment_logistics_usd
  BEFORE INSERT OR UPDATE OF logistics_cost, logistics_cost_currency
  ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.calc_shipment_logistics_usd();

-- Seed today's rate (placeholder; will be refreshed by scheduled job)
INSERT INTO public.exchange_rates (base_currency, target_currency, rate, source, rate_date)
VALUES ('EUR','USD', 1.08, 'seed', CURRENT_DATE)
ON CONFLICT (base_currency, target_currency, rate_date) DO NOTHING;

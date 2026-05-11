
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS eur_usd_rate_manual boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS eur_usd_rate_source text;

-- Snapshot helper: never auto-overwrite when manual flag is set.
CREATE OR REPLACE FUNCTION public.ensure_shipment_fx_snapshot(_shipment_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  current_rate numeric;
  is_manual boolean;
  latest_rate numeric;
  latest_rate_date date;
  latest_source text;
BEGIN
  SELECT s.eur_usd_rate, s.eur_usd_rate_manual
    INTO current_rate, is_manual
    FROM public.shipments s WHERE s.id = _shipment_id;
  IF current_rate IS NOT NULL THEN
    RETURN current_rate;
  END IF;
  SELECT er.rate, er.rate_date, er.source
    INTO latest_rate, latest_rate_date, latest_source
    FROM public.exchange_rates er
   WHERE er.base_currency='EUR' AND er.target_currency='USD'
   ORDER BY er.rate_date DESC LIMIT 1;
  IF latest_rate IS NULL THEN
    -- No cached rate available; do not silently write a stale fallback.
    RETURN NULL;
  END IF;
  IF NOT COALESCE(is_manual, false) THEN
    UPDATE public.shipments
       SET eur_usd_rate = latest_rate,
           eur_usd_rate_date = latest_rate_date,
           eur_usd_rate_source = latest_source
     WHERE id = _shipment_id;
  END IF;
  RETURN latest_rate;
END;
$function$;

-- Logistics USD calculator: respects manual override, sources latest cached rate.
CREATE OR REPLACE FUNCTION public.calc_shipment_logistics_usd()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  fx numeric;
  latest_rate numeric;
  latest_rate_date date;
  latest_source text;
BEGIN
  IF NEW.logistics_cost_currency = 'USD' THEN
    NEW.logistics_cost_usd := COALESCE(NEW.logistics_cost, 0);
  ELSE
    IF NEW.eur_usd_rate IS NULL THEN
      SELECT er.rate, er.rate_date, er.source
        INTO latest_rate, latest_rate_date, latest_source
        FROM public.exchange_rates er
       WHERE er.base_currency='EUR' AND er.target_currency='USD'
       ORDER BY er.rate_date DESC LIMIT 1;
      IF latest_rate IS NOT NULL THEN
        NEW.eur_usd_rate := latest_rate;
        NEW.eur_usd_rate_date := latest_rate_date;
        IF NEW.eur_usd_rate_source IS NULL THEN
          NEW.eur_usd_rate_source := latest_source;
        END IF;
      END IF;
    END IF;
    fx := COALESCE(NEW.eur_usd_rate, 0);
    NEW.logistics_cost_usd := COALESCE(NEW.logistics_cost, 0) * fx;
  END IF;
  RETURN NEW;
END;
$function$;

-- Mark rate row source as 'manual' when an admin sets eur_usd_rate_manual = true.
CREATE OR REPLACE FUNCTION public.tag_manual_fx_source()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.eur_usd_rate_manual = true
     AND (TG_OP = 'INSERT' OR NEW.eur_usd_rate_manual IS DISTINCT FROM OLD.eur_usd_rate_manual
          OR NEW.eur_usd_rate IS DISTINCT FROM OLD.eur_usd_rate) THEN
    NEW.eur_usd_rate_source := 'manual';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_00_tag_manual_fx ON public.shipments;
CREATE TRIGGER trg_00_tag_manual_fx
  BEFORE INSERT OR UPDATE OF eur_usd_rate, eur_usd_rate_manual
  ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.tag_manual_fx_source();

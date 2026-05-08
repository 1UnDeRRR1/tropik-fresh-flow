
CREATE OR REPLACE FUNCTION public.ensure_shipment_fx_snapshot(_shipment_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  current_rate numeric;
  latest_rate numeric;
  latest_rate_date date;
BEGIN
  SELECT s.eur_usd_rate INTO current_rate FROM public.shipments s WHERE s.id = _shipment_id;
  IF current_rate IS NOT NULL THEN
    RETURN current_rate;
  END IF;
  SELECT er.rate, er.rate_date INTO latest_rate, latest_rate_date
  FROM public.exchange_rates er
  WHERE er.base_currency='EUR' AND er.target_currency='USD'
  ORDER BY er.rate_date DESC LIMIT 1;
  IF latest_rate IS NULL THEN
    latest_rate := 1.08;
    latest_rate_date := CURRENT_DATE;
  END IF;
  UPDATE public.shipments
    SET eur_usd_rate = latest_rate, eur_usd_rate_date = latest_rate_date
    WHERE id = _shipment_id;
  RETURN latest_rate;
END;
$function$;

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
BEGIN
  IF NEW.logistics_cost_currency = 'USD' THEN
    NEW.logistics_cost_usd := COALESCE(NEW.logistics_cost, 0);
  ELSE
    IF NEW.eur_usd_rate IS NULL THEN
      SELECT er.rate, er.rate_date INTO latest_rate, latest_rate_date
      FROM public.exchange_rates er
      WHERE er.base_currency='EUR' AND er.target_currency='USD'
      ORDER BY er.rate_date DESC LIMIT 1;
      IF latest_rate IS NULL THEN
        latest_rate := 1.08;
        latest_rate_date := CURRENT_DATE;
      END IF;
      NEW.eur_usd_rate := latest_rate;
      NEW.eur_usd_rate_date := latest_rate_date;
    END IF;
    fx := NEW.eur_usd_rate;
    NEW.logistics_cost_usd := COALESCE(NEW.logistics_cost, 0) * fx;
  END IF;
  RETURN NEW;
END;
$function$;

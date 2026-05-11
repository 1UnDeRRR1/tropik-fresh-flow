
CREATE OR REPLACE FUNCTION public.calc_shipment_item_costs()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  ship_country text;
  ship_vehicle uuid;
  ship_log_usd numeric;
  vehicle_log_usd numeric := 0;
  v_status text;
  v_real_pallets numeric := 0;
  v_total_weight numeric := 0;
  v_avg_pp numeric := 0;
  expected_pallets numeric := 0;
  pallet_w numeric;
  freight_per_pallet numeric := 0;
  transport_per_kg numeric := 0;
  ref_row public.customs_reference%ROWTYPE;
  origin text;
  is_eu boolean;
  pct numeric;
  unit_usd numeric;
  duty_invoice numeric;
BEGIN
  SELECT country, vehicle_id, COALESCE(logistics_cost_usd,0)
    INTO ship_country, ship_vehicle, ship_log_usd
    FROM public.shipments WHERE id = NEW.shipment_id;

  origin := COALESCE(NULLIF(btrim(NEW.origin_country),''), ship_country);
  is_eu := public.is_eu_country(origin);

  SELECT * INTO ref_row FROM public.customs_reference
   WHERE active = true
     AND lower(btrim(product_name)) = lower(btrim(COALESCE(NEW.product_name,'')))
     AND lower(btrim(country)) = lower(btrim(COALESCE(origin,'')))
   ORDER BY threshold_price_usd DESC
   LIMIT 1;

  unit_usd := COALESCE(NEW.unit_price_usd, 0);

  IF ref_row.id IS NULL THEN
    NEW.customs_match_id := NULL;
    NEW.customs_cost_indicative := 0;
    NEW.customs_cost_invoice := 0;
  ELSE
    NEW.customs_match_id := ref_row.id;
    NEW.customs_cost_indicative := COALESCE(ref_row.euro1_markup_usd, 0);
    IF unit_usd <= COALESCE(ref_row.threshold_price_usd, 0) THEN
      NEW.customs_cost_invoice := COALESCE(ref_row.euro1_markup_usd, 0);
    ELSE
      pct := CASE WHEN is_eu THEN COALESCE(ref_row.euro1_percent, 0)
                  ELSE COALESCE(ref_row.customs_fee_percent, 0) END;
      duty_invoice := (unit_usd * 1.20 * pct / 100.0) + (unit_usd * 0.20) + 0.02;
      NEW.customs_cost_invoice := duty_invoice;
    END IF;
  END IF;

  -- Transport: per-pallet allocation
  IF ship_vehicle IS NOT NULL THEN
    SELECT v.status::text,
           COALESCE(v.total_pallets,0),
           COALESCE(v.total_weight_kg,0)
      INTO v_status, v_real_pallets, v_total_weight
      FROM public.vehicles v WHERE v.id = ship_vehicle;

    SELECT COALESCE(SUM(COALESCE(s.logistics_cost_usd,0)),0)
      INTO vehicle_log_usd
      FROM public.shipments s
     WHERE s.vehicle_id = ship_vehicle;
  ELSE
    v_status := 'open';
    vehicle_log_usd := ship_log_usd;
    SELECT COALESCE(SUM(COALESCE(pallet_count,0)),0),
           COALESCE(SUM(COALESCE(pallet_count,0) * COALESCE(pallet_weight,0)),0)
      INTO v_real_pallets, v_total_weight
      FROM public.shipment_items WHERE shipment_id = NEW.shipment_id;
  END IF;

  IF v_status = 'closed' THEN
    expected_pallets := GREATEST(v_real_pallets, 0);
  ELSE
    -- Open: estimate full vehicle by current weighted average per pallet
    IF v_real_pallets > 0 AND v_total_weight > 0 THEN
      v_avg_pp := v_total_weight / v_real_pallets;
      IF v_avg_pp > 0 THEN
        expected_pallets := LEAST(26, FLOOR(21500.0 / v_avg_pp));
      ELSE
        expected_pallets := 26;
      END IF;
      expected_pallets := GREATEST(expected_pallets, v_real_pallets);
    ELSE
      expected_pallets := 26;
    END IF;
  END IF;

  IF expected_pallets > 0 THEN
    freight_per_pallet := vehicle_log_usd / expected_pallets;
  END IF;
  pallet_w := COALESCE(NEW.pallet_weight, 0);
  IF pallet_w > 0 THEN
    transport_per_kg := freight_per_pallet / pallet_w;
  END IF;

  NEW.final_cost_indicative := unit_usd + transport_per_kg + COALESCE(NEW.customs_cost_indicative,0);
  NEW.final_cost_invoice    := unit_usd + transport_per_kg + COALESCE(NEW.customs_cost_invoice,0);

  RETURN NEW;
END;
$function$;

-- Trigger on vehicle changes to recompute all item costs
CREATE OR REPLACE FUNCTION public.trg_vehicle_recompute_item_costs()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  IF (NEW.status IS DISTINCT FROM OLD.status)
     OR (NEW.total_pallets IS DISTINCT FROM OLD.total_pallets)
     OR (NEW.total_weight_kg IS DISTINCT FROM OLD.total_weight_kg) THEN
    PERFORM public.recompute_vehicle_item_costs(NEW.id, NULL);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_vehicles_recompute_costs ON public.vehicles;
CREATE TRIGGER trg_vehicles_recompute_costs
AFTER UPDATE ON public.vehicles
FOR EACH ROW
EXECUTE FUNCTION public.trg_vehicle_recompute_item_costs();

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
  lookup_name text;
BEGIN
  SELECT country, vehicle_id, COALESCE(logistics_cost_usd,0)
    INTO ship_country, ship_vehicle, ship_log_usd
    FROM public.shipments WHERE id = NEW.shipment_id;

  origin := COALESCE(NULLIF(btrim(NEW.origin_country),''), ship_country);

  -- product aliases for customs lookup
  lookup_name := CASE lower(btrim(COALESCE(NEW.product_name,'')))
    WHEN 'інжирний персик' THEN 'персик'
    WHEN 'платерина нектарин' THEN 'нектарин'
    ELSE COALESCE(NEW.product_name,'')
  END;

  -- 1) try exact product + country match
  SELECT * INTO ref_row FROM public.customs_reference
   WHERE active = true
     AND lower(btrim(product_name)) = lower(btrim(lookup_name))
     AND lower(btrim(country)) = lower(btrim(COALESCE(origin,'')))
   ORDER BY threshold_price_usd DESC
   LIMIT 1;

  -- 2) fallback: same product, any country, pick row with highest indicative
  IF ref_row.id IS NULL THEN
    SELECT * INTO ref_row FROM public.customs_reference
     WHERE active = true
       AND lower(btrim(product_name)) = lower(btrim(lookup_name))
     ORDER BY euro1_markup_usd DESC NULLS LAST, threshold_price_usd DESC
     LIMIT 1;
  END IF;

  unit_usd := COALESCE(NEW.unit_price_usd, 0);

  IF ref_row.id IS NULL THEN
    NEW.customs_match_id := NULL;
    NEW.customs_cost_indicative := 0;
    NEW.customs_cost_invoice := 0;
  ELSE
    NEW.customs_match_id := ref_row.id;
    NEW.customs_cost_indicative := COALESCE(ref_row.euro1_markup_usd, 0);
    is_eu := public.is_eu_country(ref_row.country);
    IF unit_usd <= COALESCE(ref_row.threshold_price_usd, 0) THEN
      NEW.customs_cost_invoice := COALESCE(ref_row.euro1_markup_usd, 0);
    ELSE
      pct := CASE WHEN is_eu THEN COALESCE(ref_row.euro1_percent, 0)
                  ELSE COALESCE(ref_row.customs_fee_percent, 0) END;
      duty_invoice := (unit_usd * 1.20 * pct / 100.0) + (unit_usd * 0.20) + 0.02;
      NEW.customs_cost_invoice := duty_invoice;
    END IF;
  END IF;

  IF ship_vehicle IS NOT NULL THEN
    SELECT v.status::text, COALESCE(v.total_pallets,0)
      INTO v_status, v_real_pallets
      FROM public.vehicles v WHERE v.id = ship_vehicle;

    SELECT COALESCE(SUM(COALESCE(s.logistics_cost_usd,0)),0)
      INTO vehicle_log_usd
      FROM public.shipments s
     WHERE s.vehicle_id = ship_vehicle;
  ELSE
    v_status := 'open';
    vehicle_log_usd := ship_log_usd;
    SELECT COALESCE(SUM(COALESCE(pallet_count,0)),0)
      INTO v_real_pallets
      FROM public.shipment_items WHERE shipment_id = NEW.shipment_id;
  END IF;

  pallet_w := COALESCE(NEW.pallet_weight, 0);

  IF v_status = 'closed' THEN
    expected_pallets := GREATEST(v_real_pallets, 0);
  ELSE
    IF pallet_w > 0 THEN
      expected_pallets := LEAST(26, FLOOR(21500.0 / pallet_w));
      IF expected_pallets < 1 THEN expected_pallets := 1; END IF;
    ELSE
      expected_pallets := 26;
    END IF;
  END IF;

  IF expected_pallets > 0 THEN
    freight_per_pallet := vehicle_log_usd / expected_pallets;
  END IF;
  IF pallet_w > 0 THEN
    transport_per_kg := freight_per_pallet / pallet_w;
  END IF;

  NEW.final_cost_indicative := COALESCE(unit_usd,0) + transport_per_kg + COALESCE(NEW.customs_cost_indicative,0);
  NEW.final_cost_invoice    := COALESCE(unit_usd,0) + transport_per_kg + COALESCE(NEW.customs_cost_invoice,0);

  RETURN NEW;
END;
$function$;
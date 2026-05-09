-- Make transport cost vehicle-wide: compute final cost using sum of logistics across all shipments
-- in the same vehicle and total weight across all items in the same vehicle.
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
  ref_row public.customs_reference%ROWTYPE;
  unit_usd numeric;
  vat_part numeric;
  result2 numeric;
  customs_fee numeric;
  total_weight numeric := 0;
  transport_per_kg numeric := 0;
BEGIN
  SELECT country, vehicle_id, COALESCE(logistics_cost_usd, 0)
    INTO ship_country, ship_vehicle, ship_log_usd
    FROM public.shipments WHERE id = NEW.shipment_id;

  -- Find matching customs reference
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

  -- Vehicle-wide transport allocation: sum logistics across all shipments and weight across all items
  IF ship_vehicle IS NOT NULL THEN
    SELECT COALESCE(SUM(COALESCE(s.logistics_cost_usd, 0)), 0)
      INTO vehicle_log_usd
      FROM public.shipments s
      WHERE s.vehicle_id = ship_vehicle;

    SELECT COALESCE(SUM(COALESCE(si.pallet_count,0) * COALESCE(si.pallet_weight,0)), 0)
      INTO total_weight
      FROM public.shipment_items si
      JOIN public.shipments s ON s.id = si.shipment_id
      WHERE s.vehicle_id = ship_vehicle;
  ELSE
    vehicle_log_usd := ship_log_usd;
    SELECT COALESCE(SUM(COALESCE(pallet_count,0) * COALESCE(pallet_weight,0)), 0)
      INTO total_weight FROM public.shipment_items WHERE shipment_id = NEW.shipment_id;
  END IF;

  IF total_weight > 0 THEN
    transport_per_kg := vehicle_log_usd / total_weight;
  END IF;

  NEW.final_cost_indicative := unit_usd + transport_per_kg + COALESCE(NEW.customs_cost_indicative, 0);
  NEW.final_cost_invoice := unit_usd + transport_per_kg + COALESCE(NEW.customs_cost_invoice, 0);

  RETURN NEW;
END;
$function$;
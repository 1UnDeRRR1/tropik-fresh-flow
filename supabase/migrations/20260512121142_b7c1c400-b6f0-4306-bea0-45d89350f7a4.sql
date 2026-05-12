CREATE OR REPLACE FUNCTION public.recompute_vehicle_totals_for(_vehicle_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pallets numeric := 0;
  v_weight numeric := 0;
BEGIN
  IF _vehicle_id IS NULL THEN RETURN; END IF;
  SELECT
    COALESCE(SUM(COALESCE(si.pallet_count,0)), 0),
    COALESCE(SUM(COALESCE(si.pallet_count,0) * COALESCE(si.pallet_weight,0)), 0)
  INTO v_pallets, v_weight
  FROM public.shipment_items si
  JOIN public.shipments s ON s.id = si.shipment_id
  WHERE s.vehicle_id = _vehicle_id;

  UPDATE public.vehicles
    SET total_pallets = v_pallets,
        total_weight_kg = v_weight,
        status = CASE
          WHEN status = 'closed' THEN 'closed'::public.vehicle_status
          WHEN v_pallets >= 26 OR v_weight >= 21500 OR (26 - v_pallets) <= 1 OR (21500 - v_weight) <= 400 THEN 'closed'::public.vehicle_status
          ELSE 'open'::public.vehicle_status
        END,
        closed_at = CASE
          WHEN status = 'closed' THEN closed_at
          WHEN v_pallets >= 26 OR v_weight >= 21500 OR (26 - v_pallets) <= 1 OR (21500 - v_weight) <= 400 THEN COALESCE(closed_at, now())
          ELSE NULL
        END
    WHERE id = _vehicle_id;
END;
$function$;
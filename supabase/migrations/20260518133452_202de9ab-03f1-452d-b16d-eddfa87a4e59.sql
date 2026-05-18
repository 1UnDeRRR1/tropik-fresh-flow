CREATE OR REPLACE FUNCTION public.shipments_logistics_autobump()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- pending_planning -> vehicle_assigned when a vehicle is first entered
  IF NEW.logistics_status = 'pending_planning'
     AND (NEW.tractor_plate IS NOT NULL OR NEW.vehicle_plate IS NOT NULL)
     AND (OLD.tractor_plate IS NULL AND OLD.vehicle_plate IS NULL) THEN
    NEW.logistics_status := 'vehicle_assigned';
  END IF;

  -- vehicle_assigned -> ready_for_loading when all 5 required fields are filled
  IF NEW.logistics_status IN ('pending_planning','vehicle_assigned')
     AND COALESCE(NULLIF(NEW.tractor_plate,''), NULLIF(NEW.vehicle_plate,'')) IS NOT NULL
     AND NULLIF(NEW.driver_name,'') IS NOT NULL
     AND NULLIF(NEW.loading_address,'') IS NOT NULL
     AND NULLIF(NEW.loading_reference,'') IS NOT NULL
     AND NULLIF(NEW.temperature_mode,'') IS NOT NULL THEN
    NEW.logistics_status := 'ready_for_loading';
  END IF;

  RETURN NEW;
END;
$function$;
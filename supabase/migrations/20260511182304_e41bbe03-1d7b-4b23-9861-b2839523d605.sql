
DROP TRIGGER IF EXISTS trg_02_recompute_items_costs ON public.shipments;

CREATE TRIGGER trg_02_recompute_items_costs
AFTER UPDATE OF country, logistics_cost, logistics_cost_currency, logistics_cost_usd, eur_usd_rate, vehicle_id
ON public.shipments
FOR EACH ROW
EXECUTE FUNCTION public.recompute_shipment_items_costs();

-- Make the recompute condition also detect raw freight input changes,
-- not only the derived USD column.
CREATE OR REPLACE FUNCTION public.recompute_shipment_items_costs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.country IS DISTINCT FROM OLD.country
     OR NEW.logistics_cost IS DISTINCT FROM OLD.logistics_cost
     OR NEW.logistics_cost_currency IS DISTINCT FROM OLD.logistics_cost_currency
     OR NEW.logistics_cost_usd IS DISTINCT FROM OLD.logistics_cost_usd
     OR NEW.eur_usd_rate IS DISTINCT FROM OLD.eur_usd_rate
     OR NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id THEN
    PERFORM public.recompute_vehicle_item_costs(NEW.vehicle_id, NEW.id);
    IF NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id AND OLD.vehicle_id IS NOT NULL THEN
      PERFORM public.recompute_vehicle_item_costs(OLD.vehicle_id, OLD.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

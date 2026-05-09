CREATE OR REPLACE FUNCTION public.recompute_vehicle_item_costs(_vehicle_id uuid, _shipment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  IF _vehicle_id IS NOT NULL THEN
    UPDATE public.shipment_items si
       SET unit_price_usd = unit_price_usd
      FROM public.shipments s
     WHERE si.shipment_id = s.id
       AND s.vehicle_id = _vehicle_id;
  ELSIF _shipment_id IS NOT NULL THEN
    UPDATE public.shipment_items
       SET unit_price_usd = unit_price_usd
     WHERE shipment_id = _shipment_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_si_recompute_vehicle_costs()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  s_id uuid;
BEGIN
  -- Avoid recursion when our own recompute UPDATE re-fires this trigger
  IF pg_trigger_depth() > 1 THEN
    IF (TG_OP = 'DELETE') THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF (TG_OP = 'DELETE') THEN s_id := OLD.shipment_id; ELSE s_id := NEW.shipment_id; END IF;
  SELECT vehicle_id INTO v_id FROM public.shipments WHERE id = s_id;
  PERFORM public.recompute_vehicle_item_costs(v_id, s_id);
  IF (TG_OP = 'DELETE') THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS si_recompute_vehicle_costs ON public.shipment_items;
CREATE TRIGGER si_recompute_vehicle_costs
AFTER INSERT OR UPDATE OR DELETE ON public.shipment_items
FOR EACH ROW EXECUTE FUNCTION public.trg_si_recompute_vehicle_costs();

CREATE OR REPLACE FUNCTION public.recompute_shipment_items_costs()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.country IS DISTINCT FROM OLD.country
     OR NEW.logistics_cost_usd IS DISTINCT FROM OLD.logistics_cost_usd
     OR NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id THEN
    PERFORM public.recompute_vehicle_item_costs(NEW.vehicle_id, NEW.id);
    IF NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id AND OLD.vehicle_id IS NOT NULL THEN
      PERFORM public.recompute_vehicle_item_costs(OLD.vehicle_id, OLD.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
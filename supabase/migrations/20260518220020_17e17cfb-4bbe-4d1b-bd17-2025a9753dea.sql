CREATE OR REPLACE FUNCTION public.log_shipment_item_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_status shipment_status;
BEGIN
  -- Skip logging while the parent shipment is still a draft (initial data entry).
  -- History should only start once the shipment has been saved/finalized.
  SELECT status INTO v_status FROM public.shipments WHERE id = NEW.shipment_id;
  IF v_status = 'draft' THEN
    RETURN NEW;
  END IF;

  IF NEW.qty IS DISTINCT FROM OLD.qty THEN
    INSERT INTO public.shipment_item_changes(shipment_item_id, shipment_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, NEW.shipment_id, 'qty', OLD.qty::text, NEW.qty::text, auth.uid());
  END IF;
  IF NEW.unit_price IS DISTINCT FROM OLD.unit_price THEN
    INSERT INTO public.shipment_item_changes(shipment_item_id, shipment_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, NEW.shipment_id, 'unit_price', OLD.unit_price::text, NEW.unit_price::text, auth.uid());
  END IF;
  IF NEW.caliber IS DISTINCT FROM OLD.caliber THEN
    INSERT INTO public.shipment_item_changes(shipment_item_id, shipment_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, NEW.shipment_id, 'caliber', OLD.caliber, NEW.caliber, auth.uid());
  END IF;
  IF NEW.pallet_count IS DISTINCT FROM OLD.pallet_count THEN
    INSERT INTO public.shipment_item_changes(shipment_item_id, shipment_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, NEW.shipment_id, 'pallet_count', OLD.pallet_count::text, NEW.pallet_count::text, auth.uid());
  END IF;
  RETURN NEW;
END;
$function$;

-- Clean up history rows that were captured while shipments were still in draft status
-- (these came from the initial data-entry phase before the shipment was saved).
DELETE FROM public.shipment_item_changes c
USING public.shipments s
WHERE c.shipment_id = s.id AND s.status = 'draft';
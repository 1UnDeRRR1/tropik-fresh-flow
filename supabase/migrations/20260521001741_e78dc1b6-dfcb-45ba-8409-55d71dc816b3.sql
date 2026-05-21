CREATE OR REPLACE FUNCTION public.apply_manager_offer_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  ship_id uuid;
  match_item_id uuid;
BEGIN
  IF NEW.status = 'linked' AND NEW.linked_shipment_id IS NOT NULL
     AND (OLD.status IS DISTINCT FROM 'linked' OR OLD.linked_shipment_id IS DISTINCT FROM NEW.linked_shipment_id) THEN

    ship_id := NEW.linked_shipment_id;

    SELECT si.id
      INTO match_item_id
      FROM public.shipment_items si
     WHERE si.shipment_id = ship_id
       AND lower(btrim(si.product_name)) = lower(btrim(NEW.product_name))
       AND (
         NEW.origin_country IS NULL OR btrim(NEW.origin_country) = ''
         OR si.origin_country IS NULL OR btrim(si.origin_country) = ''
         OR lower(btrim(si.origin_country)) = lower(btrim(NEW.origin_country))
       )
       AND (
         NEW.caliber IS NULL OR btrim(NEW.caliber) = ''
         OR si.caliber IS NULL OR btrim(si.caliber) = ''
         OR lower(btrim(si.caliber)) = lower(btrim(NEW.caliber))
       )
       AND (
         NEW.variety IS NULL OR btrim(NEW.variety) = ''
         OR si.variety IS NULL OR btrim(si.variety) = ''
         OR lower(btrim(si.variety)) = lower(btrim(NEW.variety))
       )
     ORDER BY
       (si.linked_offer_id = NEW.id) DESC NULLS LAST,
       (COALESCE(lower(btrim(si.caliber)),'') = COALESCE(lower(btrim(NEW.caliber)),'')) DESC,
       (COALESCE(lower(btrim(si.variety)),'') = COALESCE(lower(btrim(NEW.variety)),'')) DESC,
       si.created_at ASC
     LIMIT 1;

    IF match_item_id IS NULL THEN
      RETURN NEW;
    END IF;

    UPDATE public.manager_offer_responses
       SET approved_pallets = requested_pallets
     WHERE offer_id = NEW.id
       AND approved_pallets IS NULL
       AND COALESCE(requested_pallets, 0) > 0;

    UPDATE public.shipment_items SET linked_offer_id = NEW.id
     WHERE id = match_item_id AND linked_offer_id IS DISTINCT FROM NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
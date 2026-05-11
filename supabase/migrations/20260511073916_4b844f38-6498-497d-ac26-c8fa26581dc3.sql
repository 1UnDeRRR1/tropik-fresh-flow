-- Avoid duplicate auto-distribution lines for the same (distribution, shipment_item)
CREATE UNIQUE INDEX IF NOT EXISTS distribution_items_unique_per_dist_item
  ON public.distribution_items (distribution_id, shipment_item_id);

CREATE OR REPLACE FUNCTION public.apply_manager_offer_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  resp record;
  ship_id uuid;
  match_item_id uuid;
  unit_cost_value numeric;
  dist_id uuid;
  effective_pallets numeric;
BEGIN
  IF NEW.status = 'linked' AND NEW.linked_shipment_id IS NOT NULL
     AND (OLD.status IS DISTINCT FROM 'linked' OR OLD.linked_shipment_id IS DISTINCT FROM NEW.linked_shipment_id) THEN

    ship_id := NEW.linked_shipment_id;

    -- find matching shipment item (caliber/variety only enforced when offer specifies them)
    SELECT si.id, COALESCE(si.unit_price_usd, 0)
      INTO match_item_id, unit_cost_value
      FROM public.shipment_items si
     WHERE si.shipment_id = ship_id
       AND lower(btrim(si.product_name)) = lower(btrim(NEW.product_name))
       AND (
         NEW.origin_country IS NULL OR btrim(NEW.origin_country) = ''
         OR COALESCE(lower(btrim(si.origin_country)),'') = lower(btrim(NEW.origin_country))
       )
       AND (
         NEW.caliber IS NULL OR btrim(NEW.caliber) = ''
         OR COALESCE(lower(btrim(si.caliber)),'') = lower(btrim(NEW.caliber))
       )
       AND (
         NEW.variety IS NULL OR btrim(NEW.variety) = ''
         OR COALESCE(lower(btrim(si.variety)),'') = lower(btrim(NEW.variety))
       )
     ORDER BY si.linked_offer_id = NEW.id DESC NULLS LAST
     LIMIT 1;

    IF match_item_id IS NULL THEN
      RETURN NEW;
    END IF;

    -- ensure shipment_item is linked to this offer
    UPDATE public.shipment_items SET linked_offer_id = NEW.id
     WHERE id = match_item_id AND linked_offer_id IS DISTINCT FROM NEW.id;

    -- auto-confirm approved_pallets = requested_pallets when not yet set
    UPDATE public.manager_offer_responses
       SET approved_pallets = requested_pallets
     WHERE offer_id = NEW.id
       AND approved_pallets IS NULL
       AND COALESCE(requested_pallets, 0) > 0;

    FOR resp IN
      SELECT * FROM public.manager_offer_responses
       WHERE offer_id = NEW.id
         AND COALESCE(approved_pallets, requested_pallets, 0) > 0
    LOOP
      effective_pallets := COALESCE(resp.approved_pallets, resp.requested_pallets, 0);
      IF effective_pallets <= 0 THEN CONTINUE; END IF;

      SELECT id INTO dist_id FROM public.distributions
       WHERE shipment_id = ship_id AND branch_id = resp.branch_id LIMIT 1;
      IF dist_id IS NULL THEN
        INSERT INTO public.distributions(shipment_id, branch_id, status, notes)
        VALUES (ship_id, resp.branch_id, 'planned', 'Авторозподіл за пропозицією')
        RETURNING id INTO dist_id;
      END IF;

      INSERT INTO public.distribution_items(distribution_id, shipment_item_id, pallets, qty, unit_cost)
      VALUES (dist_id, match_item_id, effective_pallets, 0, COALESCE(unit_cost_value, 0))
      ON CONFLICT (distribution_id, shipment_item_id)
      DO UPDATE SET pallets = EXCLUDED.pallets;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
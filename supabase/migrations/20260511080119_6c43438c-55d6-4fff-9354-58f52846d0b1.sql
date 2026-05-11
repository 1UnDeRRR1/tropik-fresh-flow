ALTER TABLE public.distribution_items
  ADD COLUMN IF NOT EXISTS reserved_pallets numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reserved_offer_id uuid REFERENCES public.manager_offers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS distribution_items_reserved_offer_idx
  ON public.distribution_items (reserved_offer_id)
  WHERE reserved_offer_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_manager_offer_distribution(_offer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  offer_row public.manager_offers%ROWTYPE;
  resp record;
  ship_id uuid;
  match_item_id uuid;
  unit_cost_value numeric := 0;
  pallet_weight_value numeric := 0;
  dist_id uuid;
  existing_pallets numeric := 0;
BEGIN
  SELECT *
    INTO offer_row
    FROM public.manager_offers
   WHERE id = _offer_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.distribution_items di
     SET pallets = GREATEST(COALESCE(di.pallets, 0) - COALESCE(di.reserved_pallets, 0), 0),
         qty = GREATEST(
           COALESCE(di.qty, 0) - (COALESCE(di.reserved_pallets, 0) * COALESCE(si.pallet_weight, 0)),
           0
         ),
         reserved_pallets = 0,
         reserved_offer_id = NULL
    FROM public.shipment_items si
   WHERE di.shipment_item_id = si.id
     AND di.reserved_offer_id = _offer_id;

  DELETE FROM public.distribution_items di
   WHERE di.reserved_offer_id IS NULL
     AND COALESCE(di.pallets, 0) <= 0;

  DELETE FROM public.distributions d
   WHERE NOT EXISTS (
     SELECT 1
       FROM public.distribution_items di
      WHERE di.distribution_id = d.id
   );

  UPDATE public.shipment_items
     SET linked_offer_id = NULL
   WHERE linked_offer_id = _offer_id;

  IF offer_row.status <> 'linked' OR offer_row.linked_shipment_id IS NULL THEN
    RETURN;
  END IF;

  ship_id := offer_row.linked_shipment_id;

  SELECT si.id,
         COALESCE(si.unit_price_usd, 0),
         COALESCE(si.pallet_weight, 0)
    INTO match_item_id, unit_cost_value, pallet_weight_value
    FROM public.shipment_items si
   WHERE si.shipment_id = ship_id
     AND lower(btrim(si.product_name)) = lower(btrim(offer_row.product_name))
     AND (
       offer_row.origin_country IS NULL
       OR btrim(offer_row.origin_country) = ''
       OR COALESCE(lower(btrim(si.origin_country)), '') = lower(btrim(offer_row.origin_country))
     )
   ORDER BY
     CASE
       WHEN offer_row.caliber IS NULL OR btrim(offer_row.caliber) = '' THEN 1
       WHEN COALESCE(lower(btrim(si.caliber)), '') = lower(btrim(offer_row.caliber)) THEN 3
       WHEN si.caliber IS NULL OR btrim(si.caliber) = '' THEN 2
       ELSE 0
     END DESC,
     CASE
       WHEN offer_row.variety IS NULL OR btrim(offer_row.variety) = '' THEN 1
       WHEN COALESCE(lower(btrim(si.variety)), '') = lower(btrim(offer_row.variety)) THEN 3
       WHEN si.variety IS NULL OR btrim(si.variety) = '' THEN 2
       ELSE 0
     END DESC,
     (si.linked_offer_id = _offer_id) DESC,
     si.created_at
   LIMIT 1;

  IF match_item_id IS NULL THEN
    RAISE EXCEPTION 'Не знайдено відповідний товар поставки для пропозиції % (%).', offer_row.product_name, COALESCE(offer_row.origin_country, '—');
  END IF;

  UPDATE public.shipment_items
     SET linked_offer_id = _offer_id
   WHERE id = match_item_id;

  FOR resp IN
    SELECT r.branch_id,
           GREATEST(COALESCE(r.approved_pallets, r.requested_pallets, 0), 0) AS effective_pallets
      FROM public.manager_offer_responses r
     WHERE r.offer_id = _offer_id
       AND GREATEST(COALESCE(r.approved_pallets, r.requested_pallets, 0), 0) > 0
  LOOP
    SELECT id
      INTO dist_id
      FROM public.distributions
     WHERE shipment_id = ship_id
       AND branch_id = resp.branch_id
     LIMIT 1;

    IF dist_id IS NULL THEN
      INSERT INTO public.distributions(shipment_id, branch_id, status, notes)
      VALUES (ship_id, resp.branch_id, 'planned', 'Авторозподіл за пропозицією')
      RETURNING id INTO dist_id;
    END IF;

    SELECT COALESCE(di.pallets, 0)
      INTO existing_pallets
      FROM public.distribution_items di
     WHERE di.distribution_id = dist_id
       AND di.shipment_item_id = match_item_id
     LIMIT 1;

    IF FOUND THEN
      UPDATE public.distribution_items di
         SET pallets = existing_pallets + resp.effective_pallets,
             qty = (existing_pallets + resp.effective_pallets) * pallet_weight_value,
             unit_cost = COALESCE(unit_cost_value, di.unit_cost, 0),
             reserved_pallets = resp.effective_pallets,
             reserved_offer_id = _offer_id
       WHERE di.distribution_id = dist_id
         AND di.shipment_item_id = match_item_id;
    ELSE
      INSERT INTO public.distribution_items(
        distribution_id,
        shipment_item_id,
        pallets,
        qty,
        unit_cost,
        reserved_pallets,
        reserved_offer_id
      )
      VALUES (
        dist_id,
        match_item_id,
        resp.effective_pallets,
        resp.effective_pallets * pallet_weight_value,
        COALESCE(unit_cost_value, 0),
        resp.effective_pallets,
        _offer_id
      );
    END IF;
  END LOOP;

  DELETE FROM public.distribution_items di
   WHERE di.reserved_offer_id IS NULL
     AND COALESCE(di.pallets, 0) <= 0;

  DELETE FROM public.distributions d
   WHERE NOT EXISTS (
     SELECT 1
       FROM public.distribution_items di
      WHERE di.distribution_id = d.id
   );
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_manager_offer_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  PERFORM public.sync_manager_offer_distribution(NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_linked_manager_offer_response()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  target_offer_id uuid;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  target_offer_id := COALESCE(NEW.offer_id, OLD.offer_id);
  IF target_offer_id IS NOT NULL THEN
    PERFORM public.sync_manager_offer_distribution(target_offer_id);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS manager_offer_responses_sync_link ON public.manager_offer_responses;
CREATE TRIGGER manager_offer_responses_sync_link
AFTER INSERT OR UPDATE OR DELETE ON public.manager_offer_responses
FOR EACH ROW EXECUTE FUNCTION public.sync_linked_manager_offer_response();
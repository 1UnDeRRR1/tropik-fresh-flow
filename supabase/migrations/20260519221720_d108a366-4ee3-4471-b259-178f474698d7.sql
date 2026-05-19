ALTER TABLE public.manager_offer_responses
  ADD COLUMN IF NOT EXISTS linked_pallets numeric NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.sync_manager_offer_distribution(_offer_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  offer_row public.manager_offers%ROWTYPE;
  resp record;
  ship_id uuid;
  match_item_id uuid;
  unit_cost_value numeric := 0;
  pallet_weight_value numeric := 0;
  matched_final_indicative numeric;
  matched_final_invoice numeric;
  item_pallet_capacity numeric := 0;
  used_capacity numeric := 0;
  free_capacity numeric := 0;
  alloc numeric := 0;
  ship_eta_value date;
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

  -- Clear previous reservation for this offer
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
     SELECT 1 FROM public.distribution_items di WHERE di.distribution_id = d.id
   );

  UPDATE public.shipment_items
     SET linked_offer_id = NULL
   WHERE linked_offer_id = _offer_id;

  -- Reset all linked_pallets for this offer (will be re-assigned below if linked)
  UPDATE public.manager_offer_responses
     SET linked_pallets = 0
   WHERE offer_id = _offer_id
     AND linked_pallets <> 0;

  IF offer_row.status <> 'linked' OR offer_row.linked_shipment_id IS NULL THEN
    RETURN;
  END IF;

  ship_id := offer_row.linked_shipment_id;

  SELECT si.id,
         COALESCE(si.unit_price_usd, 0),
         COALESCE(si.pallet_weight, 0),
         COALESCE(si.final_cost_indicative, 0),
         COALESCE(si.final_cost_invoice, 0),
         COALESCE(si.pallet_count, 0)
    INTO match_item_id, unit_cost_value, pallet_weight_value,
         matched_final_indicative, matched_final_invoice,
         item_pallet_capacity
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

  SELECT s.eta INTO ship_eta_value FROM public.shipments s WHERE s.id = ship_id;

  UPDATE public.manager_offers
     SET indicative_cost_usd = matched_final_indicative,
         invoice_cost_usd = matched_final_invoice,
         expected_eta = COALESCE(ship_eta_value, expected_eta)
   WHERE id = _offer_id;

  -- Compute remaining capacity on the shipment item (excluding other reservations on it)
  SELECT COALESCE(SUM(COALESCE(di.pallets, 0)), 0)
    INTO used_capacity
    FROM public.distribution_items di
   WHERE di.shipment_item_id = match_item_id;

  free_capacity := GREATEST(COALESCE(item_pallet_capacity, 0) - used_capacity, 0);

  -- If no capacity declared, fall back to unlimited (legacy behavior)
  IF COALESCE(item_pallet_capacity, 0) <= 0 THEN
    free_capacity := NULL; -- sentinel for "unlimited"
  END IF;

  -- FIFO allocation by response created_at
  FOR resp IN
    SELECT r.id AS response_id,
           r.branch_id,
           GREATEST(COALESCE(r.approved_pallets, r.requested_pallets, 0), 0) AS effective_pallets
      FROM public.manager_offer_responses r
     WHERE r.offer_id = _offer_id
       AND GREATEST(COALESCE(r.approved_pallets, r.requested_pallets, 0), 0) > 0
     ORDER BY r.created_at ASC, r.id ASC
  LOOP
    IF free_capacity IS NULL THEN
      alloc := resp.effective_pallets;
    ELSE
      IF free_capacity <= 0 THEN
        EXIT;
      END IF;
      alloc := LEAST(resp.effective_pallets, free_capacity);
      free_capacity := free_capacity - alloc;
    END IF;

    IF alloc <= 0 THEN
      CONTINUE;
    END IF;

    UPDATE public.manager_offer_responses
       SET linked_pallets = alloc
     WHERE id = resp.response_id;

    SELECT id INTO dist_id
      FROM public.distributions
     WHERE shipment_id = ship_id AND branch_id = resp.branch_id
     LIMIT 1;

    IF dist_id IS NULL THEN
      INSERT INTO public.distributions(shipment_id, branch_id, status, notes)
      VALUES (ship_id, resp.branch_id, 'planned', 'Авторозподіл за пропозицією')
      RETURNING id INTO dist_id;
    END IF;

    SELECT COALESCE(di.pallets, 0) INTO existing_pallets
      FROM public.distribution_items di
     WHERE di.distribution_id = dist_id
       AND di.shipment_item_id = match_item_id
     LIMIT 1;

    IF FOUND THEN
      UPDATE public.distribution_items di
         SET pallets = existing_pallets + alloc,
             qty = (existing_pallets + alloc) * pallet_weight_value,
             unit_cost = COALESCE(unit_cost_value, di.unit_cost, 0),
             reserved_pallets = alloc,
             reserved_offer_id = _offer_id
       WHERE di.distribution_id = dist_id
         AND di.shipment_item_id = match_item_id;
    ELSE
      INSERT INTO public.distribution_items(
        distribution_id, shipment_item_id, pallets, qty, unit_cost,
        reserved_pallets, reserved_offer_id
      )
      VALUES (
        dist_id, match_item_id, alloc, alloc * pallet_weight_value,
        COALESCE(unit_cost_value, 0), alloc, _offer_id
      );
    END IF;
  END LOOP;

  DELETE FROM public.distribution_items di
   WHERE di.reserved_offer_id IS NULL
     AND COALESCE(di.pallets, 0) <= 0;

  DELETE FROM public.distributions d
   WHERE NOT EXISTS (
     SELECT 1 FROM public.distribution_items di WHERE di.distribution_id = d.id
   );
END;
$function$;
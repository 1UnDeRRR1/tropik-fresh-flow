CREATE OR REPLACE FUNCTION public.sync_manager_offer_distribution(_offer_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  offer_row public.manager_offers%ROWTYPE;
  item record;
  resp record;
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
  di_id uuid;
  existing_pallets numeric := 0;
  primary_ship_id uuid := NULL;
  any_item_found boolean := false;
  any_remaining boolean := false;
BEGIN
  SELECT * INTO offer_row FROM public.manager_offers WHERE id = _offer_id;
  IF NOT FOUND THEN RETURN; END IF;

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

  UPDATE public.manager_offer_responses
     SET linked_pallets = 0
   WHERE offer_id = _offer_id
     AND COALESCE(linked_pallets, 0) <> 0;

  IF offer_row.status <> 'linked' THEN
    RETURN;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _moo_pending(
    response_id uuid PRIMARY KEY,
    branch_id uuid,
    remaining numeric,
    seq int
  ) ON COMMIT DROP;
  TRUNCATE TABLE _moo_pending;

  -- FIFO by response arrival time (earliest branch reply gets priority)
  INSERT INTO _moo_pending(response_id, branch_id, remaining, seq)
  SELECT r.id, r.branch_id,
         GREATEST(COALESCE(r.approved_pallets, r.requested_pallets, 0), 0),
         row_number() OVER (ORDER BY r.created_at ASC, r.id ASC)
    FROM public.manager_offer_responses r
   WHERE r.offer_id = _offer_id
     AND GREATEST(COALESCE(r.approved_pallets, r.requested_pallets, 0), 0) > 0;

  FOR item IN
    SELECT si.id AS item_id,
           si.shipment_id,
           COALESCE(si.unit_price_usd, 0) AS unit_price_usd,
           COALESCE(si.pallet_weight, 0) AS pallet_weight,
           COALESCE(si.final_cost_indicative, 0) AS final_indicative,
           COALESCE(si.final_cost_invoice, 0) AS final_invoice,
           COALESCE(si.pallet_count, 0) AS capacity,
           s.eta AS ship_eta
      FROM public.shipment_items si
      JOIN public.shipments s ON s.id = si.shipment_id
     WHERE si.linked_offer_id = _offer_id
     ORDER BY s.created_at ASC, si.created_at ASC
  LOOP
    any_item_found := true;
    unit_cost_value := item.unit_price_usd;
    pallet_weight_value := item.pallet_weight;
    item_pallet_capacity := item.capacity;

    IF primary_ship_id IS NULL THEN
      primary_ship_id := item.shipment_id;
      matched_final_indicative := item.final_indicative;
      matched_final_invoice := item.final_invoice;
      ship_eta_value := item.ship_eta;
    END IF;

    SELECT COALESCE(SUM(COALESCE(di.pallets, 0)), 0)
      INTO used_capacity
      FROM public.distribution_items di
     WHERE di.shipment_item_id = item.item_id;

    IF item_pallet_capacity <= 0 THEN
      free_capacity := NULL;
    ELSE
      free_capacity := GREATEST(item_pallet_capacity - used_capacity, 0);
    END IF;

    FOR resp IN
      SELECT response_id, branch_id, remaining
        FROM _moo_pending
       WHERE remaining > 0
       ORDER BY seq
    LOOP
      IF free_capacity IS NOT NULL AND free_capacity <= 0 THEN
        EXIT;
      END IF;

      IF free_capacity IS NULL THEN
        alloc := resp.remaining;
      ELSE
        alloc := LEAST(resp.remaining, free_capacity);
      END IF;

      IF alloc <= 0 THEN CONTINUE; END IF;

      IF free_capacity IS NOT NULL THEN
        free_capacity := free_capacity - alloc;
      END IF;

      UPDATE public.manager_offer_responses
         SET linked_pallets = COALESCE(linked_pallets, 0) + alloc
       WHERE id = resp.response_id;

      UPDATE _moo_pending
         SET remaining = remaining - alloc
       WHERE response_id = resp.response_id;

      SELECT id INTO dist_id
        FROM public.distributions
       WHERE shipment_id = item.shipment_id
         AND branch_id = resp.branch_id
       LIMIT 1;

      IF dist_id IS NULL THEN
        INSERT INTO public.distributions(shipment_id, branch_id, status, notes)
        VALUES (item.shipment_id, resp.branch_id, 'planned', 'Авторозподіл за пропозицією')
        RETURNING id INTO dist_id;
      END IF;

      SELECT di.id, COALESCE(di.pallets, 0)
        INTO di_id, existing_pallets
        FROM public.distribution_items di
       WHERE di.distribution_id = dist_id
         AND di.shipment_item_id = item.item_id
       LIMIT 1;

      IF di_id IS NOT NULL THEN
        UPDATE public.distribution_items
           SET pallets = existing_pallets + alloc,
               qty = (existing_pallets + alloc) * pallet_weight_value,
               unit_cost = COALESCE(unit_cost_value, unit_cost, 0),
               reserved_pallets = COALESCE(reserved_pallets, 0) + alloc,
               reserved_offer_id = _offer_id
         WHERE id = di_id;
      ELSE
        INSERT INTO public.distribution_items(
          distribution_id, shipment_item_id, pallets, qty, unit_cost,
          reserved_pallets, reserved_offer_id
        )
        VALUES (
          dist_id, item.item_id, alloc, alloc * pallet_weight_value,
          COALESCE(unit_cost_value, 0), alloc, _offer_id
        );
      END IF;
    END LOOP;
  END LOOP;

  IF primary_ship_id IS NOT NULL THEN
    UPDATE public.manager_offers
       SET indicative_cost_usd = matched_final_indicative,
           invoice_cost_usd = matched_final_invoice,
           expected_eta = COALESCE(ship_eta_value, expected_eta),
           linked_shipment_id = primary_ship_id
     WHERE id = _offer_id;
  END IF;

  -- If some approved pallets did not fit into any linked shipment, revert the
  -- offer back to 'confirmed' so it stays active on the manager board and
  -- the remainder can be linked to another shipment later.
  SELECT EXISTS (SELECT 1 FROM _moo_pending WHERE remaining > 0) INTO any_remaining;

  IF any_item_found AND any_remaining THEN
    UPDATE public.manager_offers
       SET status = 'confirmed'
     WHERE id = _offer_id
       AND status = 'linked';
  END IF;

  IF NOT any_item_found THEN
    RETURN;
  END IF;
END;
$function$;
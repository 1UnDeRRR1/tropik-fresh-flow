-- Tropik — Fix sync visibility for split-allocation
-- Bug: sync_manager_offer_distribution exits early when offer.status NOT IN ('linked','confirmed').
-- The attach RPC only bumps 'draft' → 'linked', leaving 'active'/'in_work' offers unsynced.
-- Symptom: links exist, dialog shows correct remaining (computed from links), but
-- manager_offer_responses.linked_pallets stays 0 (so the main table shows stale remaining),
-- and distribution_items.reserved_offer_id is never set (so branches don't see goods).
--
-- Fix:
-- 1) link_manager_offer_to_shipment_item: bump status to 'linked' from any non-terminal state.
-- 2) sync_manager_offer_distribution: allocate whenever links exist, regardless of prior status.

CREATE OR REPLACE FUNCTION public.link_manager_offer_to_shipment_item(
  p_offer_id uuid,
  p_shipment_item_id uuid,
  p_pallets numeric,
  p_allow_caliber_mismatch boolean DEFAULT false
)
RETURNS TABLE (
  remaining_to_load numeric,
  link_id uuid,
  shipment_item_id uuid,
  shipment_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offer      public.manager_offers%ROWTYPE;
  v_item       public.shipment_items%ROWTYPE;
  v_ship       public.shipments%ROWTYPE;
  v_caller     uuid := auth.uid();
  v_used_item  numeric;
  v_avail_item numeric;
  v_approved   numeric;
  v_linked_now numeric;
  v_remaining_offer numeric;
  v_link_id    uuid;
  v_existing_pallets numeric := 0;
  v_caliber_offer text;
  v_caliber_item  text;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF p_pallets IS NULL OR p_pallets <= 0 THEN RAISE EXCEPTION 'invalid_pallets'; END IF;

  SELECT * INTO v_offer FROM public.manager_offers WHERE id = p_offer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'offer_not_found'; END IF;

  SELECT * INTO v_item FROM public.shipment_items WHERE id = p_shipment_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'shipment_item_not_found'; END IF;

  SELECT * INTO v_ship FROM public.shipments WHERE id = v_item.shipment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'shipment_not_found'; END IF;

  IF NOT (
    public.is_admin(v_caller)
    OR (public.is_staff(v_caller) AND public.is_shipment_owner(v_item.shipment_id, v_caller))
    OR v_offer.created_by = v_caller
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_ship.status IN ('cancelled','archived') THEN
    RAISE EXCEPTION 'shipment_not_active';
  END IF;

  IF lower(btrim(coalesce(v_item.product_name,''))) <> lower(btrim(coalesce(v_offer.product_name,''))) THEN
    RAISE EXCEPTION 'product_mismatch';
  END IF;
  IF v_offer.origin_country IS NOT NULL AND v_item.origin_country IS NOT NULL
     AND lower(btrim(v_item.origin_country)) <> lower(btrim(v_offer.origin_country)) THEN
    RAISE EXCEPTION 'country_mismatch';
  END IF;

  v_caliber_offer := nullif(btrim(coalesce(v_offer.caliber,'')), '');
  v_caliber_item  := nullif(btrim(coalesce(v_item.caliber,'')),  '');
  IF v_caliber_offer IS NOT NULL AND v_caliber_item IS NOT NULL
     AND lower(v_caliber_offer) <> lower(v_caliber_item)
     AND NOT p_allow_caliber_mismatch THEN
    RAISE EXCEPTION 'caliber_mismatch';
  END IF;

  SELECT coalesce(sum(coalesce(di.pallets, 0)), 0)
    INTO v_used_item
    FROM public.distribution_items di
   WHERE di.shipment_item_id = p_shipment_item_id;

  SELECT coalesce(pallets, 0) INTO v_existing_pallets
    FROM public.manager_offer_shipment_links
   WHERE offer_id = p_offer_id AND shipment_item_id = p_shipment_item_id;
  v_existing_pallets := coalesce(v_existing_pallets, 0);

  v_avail_item := greatest(
    coalesce(v_item.pallet_count, 0) - (v_used_item - v_existing_pallets),
    0
  );

  SELECT coalesce(sum(approved_pallets) FILTER (WHERE approved_pallets > 0), 0)
    INTO v_approved
    FROM public.manager_offer_responses
   WHERE offer_id = p_offer_id;

  SELECT coalesce(sum(pallets), 0) INTO v_linked_now
    FROM public.manager_offer_shipment_links
   WHERE offer_id = p_offer_id;

  v_remaining_offer := greatest(v_approved - (v_linked_now - v_existing_pallets), 0);

  IF p_pallets + v_existing_pallets > v_avail_item THEN
    RAISE EXCEPTION 'not_enough_capacity_on_item';
  END IF;
  IF p_pallets > v_remaining_offer THEN
    RAISE EXCEPTION 'exceeds_offer_remaining';
  END IF;

  INSERT INTO public.manager_offer_shipment_links(
    offer_id, shipment_item_id, pallets,
    allow_caliber_mismatch, original_caliber, final_caliber,
    created_by
  ) VALUES (
    p_offer_id, p_shipment_item_id, p_pallets,
    p_allow_caliber_mismatch, v_offer.caliber, v_item.caliber,
    v_caller
  )
  ON CONFLICT (offer_id, shipment_item_id) DO UPDATE
    SET pallets = public.manager_offer_shipment_links.pallets + EXCLUDED.pallets,
        allow_caliber_mismatch = public.manager_offer_shipment_links.allow_caliber_mismatch
                                  OR EXCLUDED.allow_caliber_mismatch,
        original_caliber = coalesce(public.manager_offer_shipment_links.original_caliber, EXCLUDED.original_caliber),
        final_caliber    = EXCLUDED.final_caliber
  RETURNING id INTO v_link_id;

  -- FIX: bump status to 'linked' from any non-terminal state so sync allocates.
  UPDATE public.manager_offers
     SET status = CASE
                    WHEN status IN ('draft','active','in_work') THEN 'linked'::manager_offer_status
                    ELSE status
                  END,
         linked_shipment_id = coalesce(linked_shipment_id, v_item.shipment_id),
         updated_at = now()
   WHERE id = p_offer_id;

  PERFORM public.sync_manager_offer_distribution(p_offer_id);

  SELECT coalesce(sum(approved_pallets) FILTER (WHERE approved_pallets > 0), 0)
    INTO v_approved
    FROM public.manager_offer_responses WHERE offer_id = p_offer_id;
  SELECT coalesce(sum(pallets), 0) INTO v_linked_now
    FROM public.manager_offer_shipment_links WHERE offer_id = p_offer_id;

  RETURN QUERY SELECT greatest(v_approved - v_linked_now, 0),
                      v_link_id, p_shipment_item_id, v_item.shipment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.link_manager_offer_to_shipment_item(uuid, uuid, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_manager_offer_to_shipment_item(uuid, uuid, numeric, boolean) TO authenticated;


CREATE OR REPLACE FUNCTION public.sync_manager_offer_distribution(_offer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  offer_row public.manager_offers%ROWTYPE;
  lnk record;
  resp record;
  unit_cost_value numeric := 0;
  pallet_weight_value numeric := 0;
  matched_final_indicative numeric;
  matched_final_invoice numeric;
  used_other numeric := 0;
  free_for_this_link numeric := 0;
  alloc numeric := 0;
  ship_eta_value date;
  dist_id uuid;
  di_id uuid;
  existing_pallets numeric := 0;
  primary_ship_id uuid := NULL;
  any_item_found boolean := false;
  any_remaining boolean := false;
  has_links boolean := false;
BEGIN
  PERFORM set_config('lovable.in_sync_distribution', 'on', true);

  SELECT * INTO offer_row FROM public.manager_offers WHERE id = _offer_id;
  IF NOT FOUND THEN
    PERFORM set_config('lovable.in_sync_distribution', 'off', true);
    RETURN;
  END IF;

  -- Clear previous reservations for THIS offer
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
   WHERE NOT EXISTS (SELECT 1 FROM public.distribution_items di WHERE di.distribution_id = d.id);

  UPDATE public.manager_offer_responses
     SET linked_pallets = 0
   WHERE offer_id = _offer_id
     AND COALESCE(linked_pallets, 0) <> 0;

  -- FIX: allocate whenever links exist; the source of truth is manager_offer_shipment_links.
  SELECT EXISTS (SELECT 1 FROM public.manager_offer_shipment_links WHERE offer_id = _offer_id)
    INTO has_links;
  IF NOT has_links THEN
    PERFORM set_config('lovable.in_sync_distribution', 'off', true);
    RETURN;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _moo_pending(
    response_id uuid PRIMARY KEY,
    branch_id uuid,
    remaining numeric,
    approved  numeric,
    seq int
  ) ON COMMIT DROP;
  TRUNCATE TABLE _moo_pending;

  INSERT INTO _moo_pending(response_id, branch_id, remaining, approved, seq)
  SELECT r.id, r.branch_id,
         GREATEST(COALESCE(r.approved_pallets, 0), 0),
         GREATEST(COALESCE(r.approved_pallets, 0), 0),
         row_number() OVER (ORDER BY r.created_at ASC, r.id ASC)
    FROM public.manager_offer_responses r
   WHERE r.offer_id = _offer_id
     AND COALESCE(r.approved_pallets, 0) > 0;

  FOR lnk IN
    SELECT l.id                AS link_id,
           l.shipment_item_id  AS item_id,
           l.pallets           AS link_pallets,
           si.shipment_id      AS shipment_id,
           COALESCE(si.unit_price_usd, 0)        AS unit_price_usd,
           COALESCE(si.pallet_weight, 0)         AS pallet_weight,
           COALESCE(si.final_cost_indicative, 0) AS final_indicative,
           COALESCE(si.final_cost_invoice, 0)    AS final_invoice,
           COALESCE(si.pallet_count, 0)          AS capacity,
           s.eta                                 AS ship_eta
      FROM public.manager_offer_shipment_links l
      JOIN public.shipment_items si ON si.id = l.shipment_item_id
      JOIN public.shipments s ON s.id = si.shipment_id
     WHERE l.offer_id = _offer_id
     ORDER BY l.created_at ASC
  LOOP
    any_item_found := true;
    unit_cost_value := lnk.unit_price_usd;
    pallet_weight_value := lnk.pallet_weight;

    IF primary_ship_id IS NULL THEN
      primary_ship_id := lnk.shipment_id;
      matched_final_indicative := lnk.final_indicative;
      matched_final_invoice := lnk.final_invoice;
      ship_eta_value := lnk.ship_eta;
    END IF;

    SELECT COALESCE(SUM(COALESCE(di.pallets, 0)), 0)
      INTO used_other
      FROM public.distribution_items di
     WHERE di.shipment_item_id = lnk.item_id;

    IF lnk.capacity <= 0 THEN
      free_for_this_link := lnk.link_pallets;
    ELSE
      free_for_this_link := LEAST(lnk.link_pallets, GREATEST(lnk.capacity - used_other, 0));
    END IF;

    IF free_for_this_link <= 0 THEN CONTINUE; END IF;

    FOR resp IN
      SELECT response_id, branch_id, remaining
        FROM _moo_pending
       WHERE remaining > 0
       ORDER BY seq
    LOOP
      IF free_for_this_link <= 0 THEN EXIT; END IF;
      alloc := LEAST(resp.remaining, free_for_this_link);
      IF alloc <= 0 THEN CONTINUE; END IF;
      free_for_this_link := free_for_this_link - alloc;

      UPDATE public.manager_offer_responses
         SET linked_pallets = COALESCE(linked_pallets, 0) + alloc
       WHERE id = resp.response_id;

      UPDATE _moo_pending SET remaining = remaining - alloc WHERE response_id = resp.response_id;

      SELECT id INTO dist_id FROM public.distributions
       WHERE shipment_id = lnk.shipment_id AND branch_id = resp.branch_id LIMIT 1;
      IF dist_id IS NULL THEN
        INSERT INTO public.distributions(shipment_id, branch_id, status, notes)
        VALUES (lnk.shipment_id, resp.branch_id, 'planned', 'Авторозподіл за пропозицією')
        RETURNING id INTO dist_id;
      END IF;

      SELECT di.id, COALESCE(di.pallets, 0) INTO di_id, existing_pallets
        FROM public.distribution_items di
       WHERE di.distribution_id = dist_id AND di.shipment_item_id = lnk.item_id LIMIT 1;

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
        ) VALUES (
          dist_id, lnk.item_id, alloc, alloc * pallet_weight_value,
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

  SELECT EXISTS (SELECT 1 FROM _moo_pending WHERE remaining > 0) INTO any_remaining;
  IF any_item_found AND NOT any_remaining THEN
    UPDATE public.manager_offers SET status = 'confirmed'
     WHERE id = _offer_id AND status = 'linked';
  END IF;

  PERFORM set_config('lovable.in_sync_distribution', 'off', true);
END;
$$;

-- Re-sync existing offers that have links so historical data heals immediately.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT offer_id FROM public.manager_offer_shipment_links LOOP
    PERFORM public.sync_manager_offer_distribution(r.offer_id);
  END LOOP;
END $$;
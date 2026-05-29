CREATE OR REPLACE FUNCTION public.sync_manager_offer_distribution(_offer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  -- NEW path locals (Patch 1C)
  v_grp record;
  v_dist_id uuid;
  v_di_id uuid;
  v_existing numeric := 0;
  v_first_shipment uuid;
  v_first_eta date;
  v_first_indicative numeric;
  v_first_invoice numeric;
  -- B0 opt-in trim locals (Stage 3C / Migration 2)
  v_allow_trim boolean := false;
  v_item record;
  v_this_offer_sum numeric;
  v_other_offers_sum numeric;
  v_cap_for_this_offer numeric;
BEGIN
  PERFORM set_config('lovable.in_sync_distribution', 'on', true);

  -- B0 opt-in: ledger trim runs ONLY when a trusted caller has set
  -- lovable.allow_ledger_trim='on' for the current transaction. Trigger-driven
  -- calls (e.g. manager_offer_responses_sync_link fired by a branch updating
  -- their own response) DO NOT set this flag, so sync stays purely derived in
  -- that path -- identical to behavior before Stage 3C.
  v_allow_trim := COALESCE(current_setting('lovable.allow_ledger_trim', true), '') = 'on';

  SELECT * INTO offer_row FROM public.manager_offers WHERE id = _offer_id;
  IF NOT FOUND THEN
    PERFORM set_config('lovable.in_sync_distribution', 'off', true);
    RETURN;
  END IF;

  -- === Patch 1C NEW path: allocation_parts is source of truth ===
  IF EXISTS (SELECT 1 FROM public.manager_offer_allocation_parts WHERE offer_id = _offer_id) THEN
    BEGIN
      IF v_allow_trim THEN
        -- B0: trim THIS offer's parts only down to per-offer capacity remaining
        -- after other offers' allocations on the same shipment_item.
        FOR v_item IN
          SELECT DISTINCT p.shipment_item_id,
                 COALESCE(si.pallet_count, 0) AS cap_total
            FROM public.manager_offer_allocation_parts p
            JOIN public.shipment_items si ON si.id = p.shipment_item_id
           WHERE p.offer_id = _offer_id
             AND p.status = 'ordered'
             AND p.shipment_item_id IS NOT NULL
        LOOP
          SELECT COALESCE(SUM(pallets), 0) INTO v_this_offer_sum
            FROM public.manager_offer_allocation_parts
           WHERE offer_id = _offer_id AND status = 'ordered'
             AND shipment_item_id = v_item.shipment_item_id;
          SELECT COALESCE(SUM(pallets), 0) INTO v_other_offers_sum
            FROM public.manager_offer_allocation_parts
           WHERE offer_id <> _offer_id AND status = 'ordered'
             AND shipment_item_id = v_item.shipment_item_id;
          v_cap_for_this_offer := GREATEST(v_item.cap_total - v_other_offers_sum, 0);
          IF v_this_offer_sum > v_cap_for_this_offer THEN
            PERFORM public._trim_allocation_parts_to_capacity(
              v_item.shipment_item_id, v_cap_for_this_offer, _offer_id);
          END IF;
        END LOOP;
      END IF;

      -- C1: reset previous reservations for THIS offer
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

      -- C2: linked_pallets per response from ordered parts
      UPDATE public.manager_offer_responses r
         SET linked_pallets = COALESCE(agg.s, 0)
        FROM (
          SELECT response_id, SUM(pallets) AS s
            FROM public.manager_offer_allocation_parts
           WHERE offer_id = _offer_id AND status = 'ordered'
           GROUP BY response_id
        ) agg
       WHERE r.offer_id = _offer_id AND r.id = agg.response_id;

      UPDATE public.manager_offer_responses r
         SET linked_pallets = 0
       WHERE r.offer_id = _offer_id
         AND COALESCE(r.linked_pallets, 0) <> 0
         AND NOT EXISTS (
           SELECT 1 FROM public.manager_offer_allocation_parts p
            WHERE p.offer_id = _offer_id
              AND p.response_id = r.id
              AND p.status = 'ordered'
         );

      -- C3: UPSERT distribution_items per (shipment_id, shipment_item_id, branch_id)
      FOR v_grp IN
        SELECT p.shipment_id,
               p.shipment_item_id,
               p.branch_id,
               SUM(p.pallets) AS agg_pallets,
               MAX(COALESCE(si.unit_price_usd, 0)) AS unit_price,
               MAX(COALESCE(si.pallet_weight, 0)) AS pw
          FROM public.manager_offer_allocation_parts p
          JOIN public.shipment_items si ON si.id = p.shipment_item_id
         WHERE p.offer_id = _offer_id AND p.status = 'ordered'
         GROUP BY p.shipment_id, p.shipment_item_id, p.branch_id
      LOOP
        SELECT id INTO v_dist_id
          FROM public.distributions
         WHERE shipment_id = v_grp.shipment_id AND branch_id = v_grp.branch_id
         LIMIT 1;
        IF v_dist_id IS NULL THEN
          INSERT INTO public.distributions(shipment_id, branch_id, status, notes)
          VALUES (v_grp.shipment_id, v_grp.branch_id, 'planned', 'Авторозподіл за пропозицією')
          RETURNING id INTO v_dist_id;
        END IF;

        SELECT di.id, COALESCE(di.pallets, 0) INTO v_di_id, v_existing
          FROM public.distribution_items di
         WHERE di.distribution_id = v_dist_id
           AND di.shipment_item_id = v_grp.shipment_item_id
         LIMIT 1;

        IF v_di_id IS NOT NULL THEN
          UPDATE public.distribution_items
             SET pallets = v_existing + v_grp.agg_pallets,
                 qty = (v_existing + v_grp.agg_pallets) * v_grp.pw,
                 unit_cost = COALESCE(v_grp.unit_price, unit_cost, 0),
                 reserved_pallets = v_grp.agg_pallets,
                 reserved_offer_id = _offer_id
           WHERE id = v_di_id;
        ELSE
          INSERT INTO public.distribution_items(
            distribution_id, shipment_item_id, pallets, qty, unit_cost,
            reserved_pallets, reserved_offer_id
          ) VALUES (
            v_dist_id, v_grp.shipment_item_id, v_grp.agg_pallets,
            v_grp.agg_pallets * v_grp.pw, COALESCE(v_grp.unit_price, 0),
            v_grp.agg_pallets, _offer_id
          );
        END IF;
      END LOOP;

      -- C4: first ordered part → linked_shipment / eta / cost
      SELECT p.shipment_id, s.eta, si.final_cost_indicative, si.final_cost_invoice
        INTO v_first_shipment, v_first_eta, v_first_indicative, v_first_invoice
        FROM public.manager_offer_allocation_parts p
        JOIN public.shipment_items si ON si.id = p.shipment_item_id
        JOIN public.shipments s ON s.id = p.shipment_id
       WHERE p.offer_id = _offer_id AND p.status = 'ordered'
       ORDER BY p.created_at ASC, p.id ASC
       LIMIT 1;

      IF v_first_shipment IS NOT NULL THEN
        UPDATE public.manager_offers
           SET linked_shipment_id = v_first_shipment,
               expected_eta = COALESCE(v_first_eta, expected_eta),
               indicative_cost_usd = COALESCE(v_first_indicative, indicative_cost_usd),
               invoice_cost_usd = COALESCE(v_first_invoice, invoice_cost_usd)
         WHERE id = _offer_id;
      END IF;

      -- C5: status → linked (guarded in WHERE, never confirmed)
      IF EXISTS (SELECT 1 FROM public.manager_offer_allocation_parts
                  WHERE offer_id = _offer_id AND status = 'ordered') THEN
        UPDATE public.manager_offers
           SET status = 'linked'
         WHERE id = _offer_id
           AND status IN ('active','in_work','confirmed','linked')
           AND status <> 'linked';
      END IF;

    EXCEPTION WHEN OTHERS THEN
      PERFORM set_config('lovable.in_sync_distribution', 'off', true);
      RAISE;
    END;

    PERFORM set_config('lovable.in_sync_distribution', 'off', true);
    RETURN;
  END IF;
  -- === end Patch 1C NEW path ===

  -- ===== LEGACY path (manager_offer_shipment_links) — UNCHANGED FROM PRIOR LIVE BODY =====
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
$function$;
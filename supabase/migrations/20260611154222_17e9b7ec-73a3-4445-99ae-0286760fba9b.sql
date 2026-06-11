
-- =====================================================================
-- Phase 2A: inert SQL writer functions (v10 + v11 patch + v12 patch)
-- All functions are SECURITY DEFINER and REVOKEd from every role so they
-- remain INERT after creation. No GRANT EXECUTE anywhere. No cron, no
-- trigger, no client-callable wrapper, no UI wiring. No new tables,
-- enums, indexes, or RLS changes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) bae_assert_pba_in_sync  (helper; caller must have locked PBA)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bae_assert_pba_in_sync(
  p_position_id          uuid,
  p_branch_id            uuid,
  p_response_id          uuid,
  p_expected_pba_ordered numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_parts_sum numeric;
BEGIN
  IF p_expected_pba_ordered IS NULL THEN
    RAISE EXCEPTION 'bae_assert_pba_in_sync: p_expected_pba_ordered is NULL (caller must pass locked pba.ordered_qty)';
  END IF;

  SELECT COALESCE(SUM(p.pallets), 0)
    INTO v_parts_sum
    FROM public.manager_offer_allocation_parts p
    JOIN public.manager_offers o ON o.id = p.offer_id
   WHERE o.position_id = p_position_id
     AND p.branch_id   = p_branch_id
     AND p.status      = 'ordered';

  IF v_parts_sum <> p_expected_pba_ordered THEN
    RAISE EXCEPTION
      'bae_assert_pba_in_sync: drift position=% branch=% pba.ordered=% parts.sum=% (response=%)',
      p_position_id, p_branch_id, p_expected_pba_ordered, v_parts_sum, p_response_id;
  END IF;
END
$fn$;

REVOKE ALL ON FUNCTION public.bae_assert_pba_in_sync(uuid, uuid, uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bae_assert_pba_in_sync(uuid, uuid, uuid, numeric) FROM anon;
REVOKE ALL ON FUNCTION public.bae_assert_pba_in_sync(uuid, uuid, uuid, numeric) FROM authenticated;
REVOKE ALL ON FUNCTION public.bae_assert_pba_in_sync(uuid, uuid, uuid, numeric) FROM service_role;


-- ---------------------------------------------------------------------
-- 2) bae_record_delivered(allocation_part_id)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bae_record_delivered(
  p_allocation_part_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_pre_response_id uuid;
  v_pre_offer_id    uuid;
  v_pre_branch_id   uuid;

  v_r    public.manager_offer_responses%ROWTYPE;
  v_o    public.manager_offers%ROWTYPE;
  v_pba  public.position_branch_allocations%ROWTYPE;
  v_part public.manager_offer_allocation_parts%ROWTYPE;
  v_ship public.shipments%ROWTYPE;

  v_today       date;
  v_occurred_at timestamptz;

  v_prod_name   text;
  v_origin_name text;
  v_variety     text;
  v_caliber     text;
  v_packaging   text;
  v_mgr_name    text;

  v_conf_src branch_archive_confirmation_cost_source;
  v_conf_st  branch_archive_confirmation_cost_status;
  v_arr_src  branch_archive_arrival_cost_source;
  v_arr_st   branch_archive_arrival_cost_status;
  v_arr_ind  numeric;
  v_arr_inv  numeric;

  v_dist_count int;
  v_dist_id    uuid;
  v_bvp_count  int;

  v_event_id uuid;
BEGIN
  v_today := ((now() AT TIME ZONE 'Europe/Kyiv')::date);

  -- Step 1: pre-read part WITHOUT FOR UPDATE (derive context only)
  SELECT response_id, offer_id, branch_id
    INTO v_pre_response_id, v_pre_offer_id, v_pre_branch_id
    FROM public.manager_offer_allocation_parts
   WHERE id = p_allocation_part_id;
  IF v_pre_response_id IS NULL THEN
    RAISE EXCEPTION 'delivered: allocation_part % missing', p_allocation_part_id;
  END IF;

  -- Step 2: lock response
  SELECT * INTO v_r FROM public.manager_offer_responses
    WHERE id = v_pre_response_id FOR UPDATE;
  IF v_r.id IS NULL
     OR v_r.branch_id <> v_pre_branch_id
     OR v_r.offer_id  <> v_pre_offer_id THEN
    RAISE EXCEPTION 'delivered: response/part pre-drift (part=%)', p_allocation_part_id;
  END IF;

  -- Step 3: lock offer
  SELECT * INTO v_o FROM public.manager_offers
    WHERE id = v_r.offer_id FOR SHARE;
  IF v_o.id IS NULL OR v_o.position_id IS NULL THEN
    RAISE EXCEPTION 'delivered: offer/position missing (offer=%)', v_r.offer_id;
  END IF;

  -- Step 4: lock PBA
  SELECT * INTO v_pba FROM public.position_branch_allocations
    WHERE position_id = v_o.position_id AND branch_id = v_r.branch_id
    FOR UPDATE;
  IF v_pba.id IS NULL THEN
    RAISE EXCEPTION 'delivered: PBA missing (position=%, branch=%)', v_o.position_id, v_r.branch_id;
  END IF;

  -- Step 5: lock allocation_part
  SELECT * INTO v_part FROM public.manager_offer_allocation_parts
    WHERE id = p_allocation_part_id
    FOR UPDATE;
  IF v_part.id IS NULL THEN
    RAISE EXCEPTION 'delivered: allocation_part % vanished under lock', p_allocation_part_id;
  END IF;

  -- Steps 6+7: re-read locked values, consistency re-check
  IF v_part.response_id <> v_r.id
     OR v_part.offer_id  <> v_o.id
     OR v_part.branch_id <> v_r.branch_id THEN
    RAISE EXCEPTION 'delivered: locked part drifted from response/offer/branch (part=%)', v_part.id;
  END IF;
  IF v_part.status <> 'ordered'
     OR v_part.shipment_id      IS NULL
     OR v_part.shipment_item_id IS NULL
     OR v_part.pallets <= 0 THEN
    RETURN NULL;
  END IF;

  -- Step 8: lock shipment
  SELECT * INTO v_ship FROM public.shipments
    WHERE id = v_part.shipment_id FOR SHARE;
  IF v_ship.id IS NULL OR v_ship.eta IS NULL THEN
    RAISE EXCEPTION 'delivered: shipment/eta missing (shipment=%)', v_part.shipment_id;
  END IF;
  IF v_ship.eta > v_today THEN
    RETURN NULL;
  END IF;
  IF v_ship.code IS NULL THEN
    RAISE EXCEPTION 'delivered: shipment % has NULL code', v_ship.id;
  END IF;

  v_occurred_at := (v_ship.eta::timestamp AT TIME ZONE 'Europe/Kyiv');

  -- Snapshot sources
  SELECT pd.product_name_ua, c.name, pv.variety, op.caliber, op.packaging
    INTO v_prod_name, v_origin_name, v_variety, v_caliber, v_packaging
    FROM public.operational_positions op
    JOIN public.product_dictionary    pd ON pd.id = op.product_id
    JOIN public.countries             c  ON c.id  = op.product_origin_country_id
    LEFT JOIN public.product_varieties pv ON pv.id = op.variety_id
   WHERE op.position_id = v_o.position_id;
  IF v_prod_name IS NULL OR v_origin_name IS NULL THEN
    RAISE EXCEPTION 'delivered: snapshot sources missing (position=%)', v_o.position_id;
  END IF;
  SELECT full_name INTO v_mgr_name FROM public.import_managers
    WHERE id = v_o.import_manager_id;

  IF v_o.indicative_cost_usd IS NOT NULL OR v_o.invoice_cost_usd IS NOT NULL THEN
    v_conf_src := 'manager_offers'; v_conf_st := 'present';
  ELSE
    v_conf_src := 'none'; v_conf_st := 'no_offer';
  END IF;

  -- Arrival cost lookup: exact distribution_id, then exact branch_visible_prices row
  SELECT COUNT(*) INTO v_dist_count
    FROM public.distributions
   WHERE branch_id   = v_part.branch_id
     AND shipment_id = v_part.shipment_id;

  IF v_dist_count = 0 THEN
    v_arr_src := 'none';
    v_arr_st  := 'no_distribution';
    v_arr_ind := NULL; v_arr_inv := NULL;

  ELSIF v_dist_count > 1 THEN
    RAISE EXCEPTION
      'delivered: multiple distributions for branch=% shipment=% — ambiguous arrival cost lookup',
      v_part.branch_id, v_part.shipment_id;

  ELSE
    SELECT id INTO v_dist_id
      FROM public.distributions
     WHERE branch_id   = v_part.branch_id
       AND shipment_id = v_part.shipment_id;

    SELECT COUNT(*) INTO v_bvp_count
      FROM public.branch_visible_prices
     WHERE distribution_id  = v_dist_id
       AND shipment_item_id = v_part.shipment_item_id
       AND branch_id        = v_part.branch_id;

    IF v_bvp_count = 0 THEN
      v_arr_src := 'none';
      v_arr_st  := 'no_distribution';
      v_arr_ind := NULL; v_arr_inv := NULL;

    ELSIF v_bvp_count > 1 THEN
      RAISE EXCEPTION
        'delivered: multiple branch_visible_prices rows for distribution=% item=% branch=% — ambiguous arrival cost',
        v_dist_id, v_part.shipment_item_id, v_part.branch_id;

    ELSE
      SELECT cost_indicative_usd, cost_invoice_usd
        INTO v_arr_ind, v_arr_inv
        FROM public.branch_visible_prices
       WHERE distribution_id  = v_dist_id
         AND shipment_item_id = v_part.shipment_item_id
         AND branch_id        = v_part.branch_id;

      IF v_arr_ind IS NOT NULL OR v_arr_inv IS NOT NULL THEN
        v_arr_src := 'branch_visible_prices';
        v_arr_st  := 'present';
      ELSE
        v_arr_src := 'none';
        v_arr_st  := 'unavailable_other';
        v_arr_ind := NULL; v_arr_inv := NULL;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.branch_archive_events (
    position_id, position_branch_allocation_id, branch_id,
    response_id, allocation_part_id, shipment_id, shipment_item_id,
    event_type, trigger_source, trigger_at, event_pallets,
    pba_status_snapshot, pba_requested_qty_snapshot, pba_approved_qty_snapshot,
    pba_ordered_qty_snapshot, pba_cancelled_qty_snapshot, pba_remaining_qty_snapshot,
    product_name_snapshot, origin_country_snapshot, variety_snapshot,
    caliber_snapshot, package_snapshot,
    shipment_code_snapshot, responsible_manager_name_snapshot,
    eta_snapshot, eta_source, shipment_eta_snapshot,
    branch_visible_cost_indicative_at_confirmation_usd,
    branch_visible_cost_invoice_at_confirmation_usd,
    confirmation_cost_snapshot_source, confirmation_cost_snapshot_status,
    branch_visible_cost_indicative_at_arrival_usd,
    branch_visible_cost_invoice_at_arrival_usd,
    arrival_cost_snapshot_source, arrival_cost_snapshot_status,
    responsible_manager_id, occurred_at
  ) VALUES (
    v_o.position_id, v_pba.id, v_part.branch_id,
    v_r.id, v_part.id, v_part.shipment_id, v_part.shipment_item_id,
    'delivered', 'shipment_eta_sweep', now(), v_part.pallets,
    v_pba.status, v_pba.requested_qty, v_pba.approved_qty,
    v_pba.ordered_qty, v_pba.cancelled_qty, COALESCE(v_pba.remaining_qty, 0),
    v_prod_name, v_origin_name, v_variety,
    v_caliber, v_packaging,
    v_ship.code, v_mgr_name,
    v_ship.eta, 'shipment_eta', v_ship.eta,
    v_o.indicative_cost_usd, v_o.invoice_cost_usd,
    v_conf_src, v_conf_st,
    v_arr_ind, v_arr_inv,
    v_arr_src, v_arr_st,
    v_o.import_manager_id, v_occurred_at
  )
  ON CONFLICT DO NOTHING
  RETURNING event_id INTO v_event_id;

  RETURN v_event_id;
END
$fn$;

REVOKE ALL ON FUNCTION public.bae_record_delivered(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bae_record_delivered(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.bae_record_delivered(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.bae_record_delivered(uuid) FROM service_role;


-- ---------------------------------------------------------------------
-- 3) bae_record_cut_normal(response_id)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bae_record_cut_normal(
  p_response_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_r   public.manager_offer_responses%ROWTYPE;
  v_o   public.manager_offers%ROWTYPE;
  v_pba public.position_branch_allocations%ROWTYPE;

  v_today        date;
  v_first_ship   uuid;
  v_first_eta    date;
  v_first_code   text;
  v_cut_pallets  numeric;
  v_occurred_at  timestamptz;

  v_prod_name   text;
  v_origin_name text;
  v_variety     text;
  v_mgr_name    text;
  v_caliber     text;
  v_packaging   text;

  v_conf_src branch_archive_confirmation_cost_source;
  v_conf_st  branch_archive_confirmation_cost_status;

  v_event_id uuid;
BEGIN
  v_today := ((now() AT TIME ZONE 'Europe/Kyiv')::date);

  SELECT * INTO v_r FROM public.manager_offer_responses
    WHERE id = p_response_id FOR UPDATE;
  IF v_r.id IS NULL THEN
    RAISE EXCEPTION 'cut_normal: response % missing', p_response_id;
  END IF;
  IF COALESCE(v_r.approved_pallets, 0) <= 0 THEN
    RAISE EXCEPTION 'cut_normal: approved=0 (response=%); refusal_zero path applies', p_response_id;
  END IF;
  v_cut_pallets := COALESCE(v_r.requested_pallets, 0) - COALESCE(v_r.approved_pallets, 0);
  IF v_cut_pallets <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_o FROM public.manager_offers
    WHERE id = v_r.offer_id FOR SHARE;
  IF v_o.id IS NULL OR v_o.position_id IS NULL THEN
    RAISE EXCEPTION 'cut_normal: offer/position missing (offer=%)', v_r.offer_id;
  END IF;

  SELECT * INTO v_pba FROM public.position_branch_allocations
    WHERE position_id = v_o.position_id AND branch_id = v_r.branch_id
    FOR UPDATE;
  IF v_pba.id IS NULL THEN
    RAISE EXCEPTION 'cut_normal: PBA missing';
  END IF;

  -- Lock every status='ordered' allocation_part for this response
  PERFORM 1
    FROM public.manager_offer_allocation_parts
   WHERE response_id = p_response_id
     AND status      = 'ordered'
   ORDER BY id
   FOR UPDATE;

  -- First eligible shipment from the now-locked set
  SELECT s.id, s.eta, s.code
    INTO v_first_ship, v_first_eta, v_first_code
    FROM public.manager_offer_allocation_parts p
    JOIN public.shipments s ON s.id = p.shipment_id
   WHERE p.response_id = p_response_id
     AND p.status      = 'ordered'
     AND p.shipment_id IS NOT NULL
     AND s.eta IS NOT NULL
     AND s.eta <= v_today
   ORDER BY s.eta ASC, s.id ASC
   LIMIT 1;
  IF v_first_ship IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_first_code IS NULL THEN
    RAISE EXCEPTION 'cut_normal: shipment % has NULL code', v_first_ship;
  END IF;

  v_occurred_at := (v_first_eta::timestamp AT TIME ZONE 'Europe/Kyiv');

  SELECT pd.product_name_ua, c.name, pv.variety, op.caliber, op.packaging
    INTO v_prod_name, v_origin_name, v_variety, v_caliber, v_packaging
    FROM public.operational_positions op
    JOIN public.product_dictionary pd ON pd.id = op.product_id
    JOIN public.countries c ON c.id = op.product_origin_country_id
    LEFT JOIN public.product_varieties pv ON pv.id = op.variety_id
   WHERE op.position_id = v_o.position_id;
  IF v_prod_name IS NULL OR v_origin_name IS NULL THEN
    RAISE EXCEPTION 'cut_normal: snapshot sources missing (position=%)', v_o.position_id;
  END IF;
  SELECT full_name INTO v_mgr_name FROM public.import_managers
    WHERE id = v_o.import_manager_id;

  IF v_o.indicative_cost_usd IS NOT NULL OR v_o.invoice_cost_usd IS NOT NULL THEN
    v_conf_src := 'manager_offers'; v_conf_st := 'present';
  ELSE
    v_conf_src := 'none'; v_conf_st := 'no_offer';
  END IF;

  INSERT INTO public.branch_archive_events (
    position_id, position_branch_allocation_id, branch_id,
    response_id, shipment_id,
    event_type, event_subtype, trigger_source, trigger_at, event_pallets,
    pba_status_snapshot, pba_requested_qty_snapshot, pba_approved_qty_snapshot,
    pba_ordered_qty_snapshot, pba_cancelled_qty_snapshot, pba_remaining_qty_snapshot,
    product_name_snapshot, origin_country_snapshot, variety_snapshot,
    caliber_snapshot, package_snapshot,
    shipment_code_snapshot, responsible_manager_name_snapshot,
    eta_snapshot, eta_source, shipment_eta_snapshot,
    branch_visible_cost_indicative_at_confirmation_usd,
    branch_visible_cost_invoice_at_confirmation_usd,
    confirmation_cost_snapshot_source, confirmation_cost_snapshot_status,
    arrival_cost_snapshot_source, arrival_cost_snapshot_status,
    responsible_manager_id, occurred_at
  ) VALUES (
    v_o.position_id, v_pba.id, v_r.branch_id,
    v_r.id, v_first_ship,
    'cut', 'normal', 'shipment_eta_sweep', now(), v_cut_pallets,
    v_pba.status, v_pba.requested_qty, v_pba.approved_qty,
    v_pba.ordered_qty, v_pba.cancelled_qty, COALESCE(v_pba.remaining_qty, 0),
    v_prod_name, v_origin_name, v_variety,
    v_caliber, v_packaging,
    v_first_code, v_mgr_name,
    v_first_eta, 'shipment_eta', v_first_eta,
    v_o.indicative_cost_usd, v_o.invoice_cost_usd,
    v_conf_src, v_conf_st,
    'none', 'not_yet_arrived',
    v_o.import_manager_id, v_occurred_at
  )
  ON CONFLICT DO NOTHING
  RETURNING event_id INTO v_event_id;

  RETURN v_event_id;
END
$fn$;

REVOKE ALL ON FUNCTION public.bae_record_cut_normal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bae_record_cut_normal(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.bae_record_cut_normal(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.bae_record_cut_normal(uuid) FROM service_role;


-- ---------------------------------------------------------------------
-- 4) bae_record_cut_option_a(response_id)
--    Option A: no linked parts exist; cut event at offer ETA.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bae_record_cut_option_a(
  p_response_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_r   public.manager_offer_responses%ROWTYPE;
  v_o   public.manager_offers%ROWTYPE;
  v_pba public.position_branch_allocations%ROWTYPE;

  v_today        date;
  v_cut_pallets  numeric;
  v_linked_count int;
  v_occurred_at  timestamptz;

  v_prod_name   text;
  v_origin_name text;
  v_variety     text;
  v_caliber     text;
  v_packaging   text;
  v_mgr_name    text;

  v_conf_src branch_archive_confirmation_cost_source;
  v_conf_st  branch_archive_confirmation_cost_status;

  v_event_id uuid;
BEGIN
  v_today := ((now() AT TIME ZONE 'Europe/Kyiv')::date);

  SELECT * INTO v_r FROM public.manager_offer_responses
    WHERE id = p_response_id FOR UPDATE;
  IF v_r.id IS NULL THEN
    RAISE EXCEPTION 'cut_option_a: response % missing', p_response_id;
  END IF;
  IF COALESCE(v_r.approved_pallets, 0) <= 0 THEN
    RAISE EXCEPTION 'cut_option_a: approved=0 (response=%); refusal_zero path applies', p_response_id;
  END IF;
  v_cut_pallets := COALESCE(v_r.requested_pallets, 0) - COALESCE(v_r.approved_pallets, 0);
  IF v_cut_pallets <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_o FROM public.manager_offers
    WHERE id = v_r.offer_id FOR SHARE;
  IF v_o.id IS NULL OR v_o.position_id IS NULL THEN
    RAISE EXCEPTION 'cut_option_a: offer/position missing (offer=%)', v_r.offer_id;
  END IF;

  -- Offer ETA eligibility (no-op if not reached)
  IF v_o.expected_eta IS NULL THEN
    RAISE EXCEPTION 'cut_option_a: offer % expected_eta is NULL', v_o.id;
  END IF;
  IF v_o.expected_eta > v_today THEN
    RETURN NULL;
  END IF;
  v_occurred_at := (v_o.expected_eta::timestamp AT TIME ZONE 'Europe/Kyiv');

  SELECT * INTO v_pba FROM public.position_branch_allocations
    WHERE position_id = v_o.position_id AND branch_id = v_r.branch_id
    FOR UPDATE;
  IF v_pba.id IS NULL THEN
    RAISE EXCEPTION 'cut_option_a: PBA missing';
  END IF;

  -- Lock any status='ordered' parts for this response (should be none for Option A)
  PERFORM 1
    FROM public.manager_offer_allocation_parts
   WHERE response_id = p_response_id
     AND status      = 'ordered'
   ORDER BY id
   FOR UPDATE;

  SELECT COUNT(*) INTO v_linked_count
    FROM public.manager_offer_allocation_parts
   WHERE response_id = p_response_id
     AND status      = 'ordered'
     AND shipment_id IS NOT NULL;
  IF v_linked_count > 0 THEN
    RETURN NULL; -- linked parts exist → cut_normal path, not Option A
  END IF;

  SELECT pd.product_name_ua, c.name, pv.variety, op.caliber, op.packaging
    INTO v_prod_name, v_origin_name, v_variety, v_caliber, v_packaging
    FROM public.operational_positions op
    JOIN public.product_dictionary pd ON pd.id = op.product_id
    JOIN public.countries c ON c.id = op.product_origin_country_id
    LEFT JOIN public.product_varieties pv ON pv.id = op.variety_id
   WHERE op.position_id = v_o.position_id;
  IF v_prod_name IS NULL OR v_origin_name IS NULL THEN
    RAISE EXCEPTION 'cut_option_a: snapshot sources missing (position=%)', v_o.position_id;
  END IF;
  SELECT full_name INTO v_mgr_name FROM public.import_managers
    WHERE id = v_o.import_manager_id;

  IF v_o.indicative_cost_usd IS NOT NULL OR v_o.invoice_cost_usd IS NOT NULL THEN
    v_conf_src := 'manager_offers'; v_conf_st := 'present';
  ELSE
    v_conf_src := 'none'; v_conf_st := 'no_offer';
  END IF;

  INSERT INTO public.branch_archive_events (
    position_id, position_branch_allocation_id, branch_id,
    response_id,
    event_type, event_subtype, trigger_source, trigger_at, event_pallets,
    pba_status_snapshot, pba_requested_qty_snapshot, pba_approved_qty_snapshot,
    pba_ordered_qty_snapshot, pba_cancelled_qty_snapshot, pba_remaining_qty_snapshot,
    product_name_snapshot, origin_country_snapshot, variety_snapshot,
    caliber_snapshot, package_snapshot, responsible_manager_name_snapshot,
    eta_snapshot, eta_source, offer_eta_snapshot,
    branch_visible_cost_indicative_at_confirmation_usd,
    branch_visible_cost_invoice_at_confirmation_usd,
    confirmation_cost_snapshot_source, confirmation_cost_snapshot_status,
    arrival_cost_snapshot_source, arrival_cost_snapshot_status,
    responsible_manager_id, occurred_at
  ) VALUES (
    v_o.position_id, v_pba.id, v_r.branch_id,
    v_r.id,
    'cut', 'option_a', 'offer_eta_sweep', now(), v_cut_pallets,
    v_pba.status, v_pba.requested_qty, v_pba.approved_qty,
    v_pba.ordered_qty, v_pba.cancelled_qty, COALESCE(v_pba.remaining_qty, 0),
    v_prod_name, v_origin_name, v_variety,
    v_caliber, v_packaging, v_mgr_name,
    v_o.expected_eta, 'offer_eta', v_o.expected_eta,
    v_o.indicative_cost_usd, v_o.invoice_cost_usd,
    v_conf_src, v_conf_st,
    'none', 'not_yet_arrived',
    v_o.import_manager_id, v_occurred_at
  )
  ON CONFLICT DO NOTHING
  RETURNING event_id INTO v_event_id;

  RETURN v_event_id;
END
$fn$;

REVOKE ALL ON FUNCTION public.bae_record_cut_option_a(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bae_record_cut_option_a(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.bae_record_cut_option_a(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.bae_record_cut_option_a(uuid) FROM service_role;


-- ---------------------------------------------------------------------
-- 5) bae_record_not_fulfilled(response_id)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bae_record_not_fulfilled(
  p_response_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_r   public.manager_offer_responses%ROWTYPE;
  v_o   public.manager_offers%ROWTYPE;
  v_pba public.position_branch_allocations%ROWTYPE;

  v_today          date;
  v_occurred_at    timestamptz;
  v_linked         numeric;
  v_prior_terminal numeric;
  v_event_pallets  numeric;
  v_new_cancelled  numeric;
  v_new_remaining  numeric;

  v_prod_name   text;
  v_origin_name text;
  v_variety     text;
  v_caliber     text;
  v_packaging   text;
  v_mgr_name    text;

  v_conf_src branch_archive_confirmation_cost_source;
  v_conf_st  branch_archive_confirmation_cost_status;

  v_event_id uuid;
BEGIN
  v_today := ((now() AT TIME ZONE 'Europe/Kyiv')::date);

  SELECT * INTO v_r FROM public.manager_offer_responses
    WHERE id = p_response_id FOR UPDATE;
  IF v_r.id IS NULL THEN
    RAISE EXCEPTION 'not_fulfilled: response % missing', p_response_id;
  END IF;
  IF COALESCE(v_r.approved_pallets, 0) <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_o FROM public.manager_offers
    WHERE id = v_r.offer_id FOR SHARE;
  IF v_o.id IS NULL OR v_o.position_id IS NULL THEN
    RAISE EXCEPTION 'not_fulfilled: offer/position missing (offer=%)', v_r.offer_id;
  END IF;
  IF v_o.expected_eta IS NULL THEN
    RAISE EXCEPTION 'not_fulfilled: offer % expected_eta is NULL', v_o.id;
  END IF;
  IF v_o.expected_eta > v_today THEN
    RETURN NULL;
  END IF;
  v_occurred_at := (v_o.expected_eta::timestamp AT TIME ZONE 'Europe/Kyiv');

  SELECT * INTO v_pba FROM public.position_branch_allocations
    WHERE position_id = v_o.position_id AND branch_id = v_r.branch_id
    FOR UPDATE;
  IF v_pba.id IS NULL THEN
    RAISE EXCEPTION 'not_fulfilled: PBA missing';
  END IF;

  -- v11 BLOCKER 2: lock rows first, then SUM in a separate statement
  PERFORM 1
    FROM public.manager_offer_allocation_parts
   WHERE response_id = p_response_id
     AND status      = 'ordered'
   ORDER BY id
   FOR UPDATE;

  SELECT COALESCE(SUM(pallets), 0)
    INTO v_linked
    FROM public.manager_offer_allocation_parts
   WHERE response_id = p_response_id
     AND status      = 'ordered';

  PERFORM public.bae_assert_pba_in_sync(
    v_o.position_id, v_r.branch_id, p_response_id, v_pba.ordered_qty);

  -- Prior approved-pool terminal pallets for this response (excludes cut & delivered)
  SELECT COALESCE(SUM(event_pallets), 0) INTO v_prior_terminal
    FROM public.branch_archive_events
   WHERE position_branch_allocation_id = v_pba.id
     AND response_id = p_response_id
     AND event_type IN ('cancelled', 'refusal_zero', 'refusal_button', 'not_fulfilled');

  v_event_pallets := GREATEST(0,
      COALESCE(v_r.approved_pallets, 0) - v_linked - v_prior_terminal);
  IF v_event_pallets <= 0 THEN
    RETURN NULL;
  END IF;

  v_new_cancelled := v_pba.cancelled_qty + v_event_pallets;
  v_new_remaining := GREATEST(0, v_pba.approved_qty - v_pba.ordered_qty - v_new_cancelled);

  SELECT pd.product_name_ua, c.name, pv.variety, op.caliber, op.packaging
    INTO v_prod_name, v_origin_name, v_variety, v_caliber, v_packaging
    FROM public.operational_positions op
    JOIN public.product_dictionary pd ON pd.id = op.product_id
    JOIN public.countries c ON c.id = op.product_origin_country_id
    LEFT JOIN public.product_varieties pv ON pv.id = op.variety_id
   WHERE op.position_id = v_o.position_id;
  IF v_prod_name IS NULL OR v_origin_name IS NULL THEN
    RAISE EXCEPTION 'not_fulfilled: snapshot sources missing';
  END IF;
  SELECT full_name INTO v_mgr_name FROM public.import_managers
    WHERE id = v_o.import_manager_id;

  IF v_o.indicative_cost_usd IS NOT NULL OR v_o.invoice_cost_usd IS NOT NULL THEN
    v_conf_src := 'manager_offers'; v_conf_st := 'present';
  ELSE
    v_conf_src := 'none'; v_conf_st := 'no_offer';
  END IF;

  INSERT INTO public.branch_archive_events (
    position_id, position_branch_allocation_id, branch_id,
    response_id,
    event_type, trigger_source, trigger_at, event_pallets,
    pba_status_snapshot, pba_requested_qty_snapshot, pba_approved_qty_snapshot,
    pba_ordered_qty_snapshot, pba_cancelled_qty_snapshot, pba_remaining_qty_snapshot,
    product_name_snapshot, origin_country_snapshot, variety_snapshot,
    caliber_snapshot, package_snapshot, responsible_manager_name_snapshot,
    eta_snapshot, eta_source, offer_eta_snapshot,
    branch_visible_cost_indicative_at_confirmation_usd,
    branch_visible_cost_invoice_at_confirmation_usd,
    confirmation_cost_snapshot_source, confirmation_cost_snapshot_status,
    arrival_cost_snapshot_source, arrival_cost_snapshot_status,
    responsible_manager_id, occurred_at
  ) VALUES (
    v_o.position_id, v_pba.id, v_r.branch_id,
    v_r.id,
    'not_fulfilled', 'offer_eta_sweep', now(), v_event_pallets,
    v_pba.status, v_pba.requested_qty, v_pba.approved_qty,
    v_pba.ordered_qty, v_new_cancelled, v_new_remaining,
    v_prod_name, v_origin_name, v_variety,
    v_caliber, v_packaging, v_mgr_name,
    v_o.expected_eta, 'offer_eta', v_o.expected_eta,
    v_o.indicative_cost_usd, v_o.invoice_cost_usd,
    v_conf_src, v_conf_st,
    'none', 'not_yet_arrived',
    v_o.import_manager_id, v_occurred_at
  )
  ON CONFLICT DO NOTHING
  RETURNING event_id INTO v_event_id;

  IF v_event_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.position_branch_allocations
     SET cancelled_qty = v_new_cancelled,
         remaining_qty = v_new_remaining,
         updated_at    = now()
   WHERE id = v_pba.id;

  RETURN v_event_id;
END
$fn$;

REVOKE ALL ON FUNCTION public.bae_record_not_fulfilled(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bae_record_not_fulfilled(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.bae_record_not_fulfilled(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.bae_record_not_fulfilled(uuid) FROM service_role;


-- ---------------------------------------------------------------------
-- 6) bae_record_refusal_zero(response_id, action_at, acting_manager_id, acting_user_id)
--    v12 argument order frozen. Does NOT call bae_assert_pba_in_sync.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bae_record_refusal_zero(
  p_response_id       uuid,
  p_action_at         timestamptz,
  p_acting_manager_id uuid,
  p_acting_user_id    uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_r   public.manager_offer_responses%ROWTYPE;
  v_o   public.manager_offers%ROWTYPE;
  v_pba public.position_branch_allocations%ROWTYPE;

  v_active_parts int;
  v_occurred_at  timestamptz;
  v_event_pallets numeric;

  v_prod_name   text;
  v_origin_name text;
  v_variety     text;
  v_caliber     text;
  v_packaging   text;
  v_mgr_name    text;

  v_conf_src branch_archive_confirmation_cost_source;
  v_conf_st  branch_archive_confirmation_cost_status;

  v_event_id uuid;
BEGIN
  IF p_action_at IS NULL THEN
    RAISE EXCEPTION 'refusal_zero: p_action_at is NULL';
  END IF;

  SELECT * INTO v_r FROM public.manager_offer_responses
    WHERE id = p_response_id FOR UPDATE;
  IF v_r.id IS NULL THEN
    RAISE EXCEPTION 'refusal_zero: response % missing', p_response_id;
  END IF;

  -- Hard guards: approved=0, requested>0
  IF COALESCE(v_r.approved_pallets, 0) <> 0 THEN
    RAISE EXCEPTION 'refusal_zero: approved_pallets must be 0 (response=%)', p_response_id;
  END IF;
  IF COALESCE(v_r.requested_pallets, 0) <= 0 THEN
    RAISE EXCEPTION 'refusal_zero: requested_pallets must be > 0 (response=%)', p_response_id;
  END IF;
  v_event_pallets := v_r.requested_pallets;

  SELECT * INTO v_o FROM public.manager_offers
    WHERE id = v_r.offer_id FOR SHARE;
  IF v_o.id IS NULL OR v_o.position_id IS NULL THEN
    RAISE EXCEPTION 'refusal_zero: offer/position missing (offer=%)', v_r.offer_id;
  END IF;

  SELECT * INTO v_pba FROM public.position_branch_allocations
    WHERE position_id = v_o.position_id AND branch_id = v_r.branch_id
    FOR UPDATE;
  IF v_pba.id IS NULL THEN
    RAISE EXCEPTION 'refusal_zero: PBA missing';
  END IF;

  -- Hard guard: no active ordered allocation parts for this response
  SELECT COUNT(*) INTO v_active_parts
    FROM public.manager_offer_allocation_parts
   WHERE response_id = p_response_id
     AND status      = 'ordered';
  IF v_active_parts <> 0 THEN
    RAISE EXCEPTION 'refusal_zero: response % has % active ordered allocation parts',
      p_response_id, v_active_parts;
  END IF;

  v_occurred_at := p_action_at;

  SELECT pd.product_name_ua, c.name, pv.variety, op.caliber, op.packaging
    INTO v_prod_name, v_origin_name, v_variety, v_caliber, v_packaging
    FROM public.operational_positions op
    JOIN public.product_dictionary pd ON pd.id = op.product_id
    JOIN public.countries c ON c.id = op.product_origin_country_id
    LEFT JOIN public.product_varieties pv ON pv.id = op.variety_id
   WHERE op.position_id = v_o.position_id;
  IF v_prod_name IS NULL OR v_origin_name IS NULL THEN
    RAISE EXCEPTION 'refusal_zero: snapshot sources missing';
  END IF;
  SELECT full_name INTO v_mgr_name FROM public.import_managers
    WHERE id = v_o.import_manager_id;

  IF v_o.indicative_cost_usd IS NOT NULL OR v_o.invoice_cost_usd IS NOT NULL THEN
    v_conf_src := 'manager_offers'; v_conf_st := 'present';
  ELSE
    v_conf_src := 'none'; v_conf_st := 'no_offer';
  END IF;

  INSERT INTO public.branch_archive_events (
    position_id, position_branch_allocation_id, branch_id,
    response_id,
    event_type, trigger_source, trigger_at, event_pallets,
    pba_status_snapshot, pba_requested_qty_snapshot, pba_approved_qty_snapshot,
    pba_ordered_qty_snapshot, pba_cancelled_qty_snapshot, pba_remaining_qty_snapshot,
    product_name_snapshot, origin_country_snapshot, variety_snapshot,
    caliber_snapshot, package_snapshot, responsible_manager_name_snapshot,
    eta_snapshot, eta_source,
    branch_visible_cost_indicative_at_confirmation_usd,
    branch_visible_cost_invoice_at_confirmation_usd,
    confirmation_cost_snapshot_source, confirmation_cost_snapshot_status,
    arrival_cost_snapshot_source, arrival_cost_snapshot_status,
    responsible_manager_id, acting_manager_id, acting_user_id, occurred_at
  ) VALUES (
    v_o.position_id, v_pba.id, v_r.branch_id,
    v_r.id,
    'refusal_zero', 'refusal_rpc', now(), v_event_pallets,
    'rejected', v_pba.requested_qty, v_pba.approved_qty,
    v_pba.ordered_qty, v_pba.cancelled_qty, 0,
    v_prod_name, v_origin_name, v_variety,
    v_caliber, v_packaging, v_mgr_name,
    (p_action_at AT TIME ZONE 'Europe/Kyiv')::date, 'refusal_time',
    v_o.indicative_cost_usd, v_o.invoice_cost_usd,
    v_conf_src, v_conf_st,
    'none', 'not_yet_arrived',
    v_o.import_manager_id, p_acting_manager_id, p_acting_user_id, v_occurred_at
  )
  ON CONFLICT DO NOTHING
  RETURNING event_id INTO v_event_id;

  IF v_event_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.position_branch_allocations
     SET status        = 'rejected',
         remaining_qty = 0,
         updated_at    = now()
   WHERE id = v_pba.id;

  RETURN v_event_id;
END
$fn$;

REVOKE ALL ON FUNCTION public.bae_record_refusal_zero(uuid, timestamptz, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bae_record_refusal_zero(uuid, timestamptz, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.bae_record_refusal_zero(uuid, timestamptz, uuid, uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.bae_record_refusal_zero(uuid, timestamptz, uuid, uuid) FROM service_role;

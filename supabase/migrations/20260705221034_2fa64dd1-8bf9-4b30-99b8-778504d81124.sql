CREATE OR REPLACE FUNCTION public.archive_cancel_manager_offer(
  p_offer_id uuid,
  p_reason   text DEFAULT NULL
)
RETURNS TABLE(action text, detail text, response_id uuid, snapshot_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_offer            public.manager_offers%ROWTYPE;
  v_resp             RECORD;
  v_snap_id          uuid;
  v_existing         public.archive_promise_snapshots%ROWTYPE;
  v_op               public.operational_positions%ROWTYPE;
  v_writer           RECORD;
  v_blocked          boolean := false;
  v_silent_del       integer := 0;

  -- Rollback-tail locals
  v_saved_position   uuid;
  v_has_decided      boolean;
  v_ship_item_count  int;
  v_alloc_count      int;
  v_link_count       int;
  v_rb_ok            boolean;
  v_rb_reason        text;
BEGIN
  IF p_offer_id IS NULL THEN
    RAISE EXCEPTION 'p_offer_id is required';
  END IF;

  SELECT * INTO v_offer FROM public.manager_offers WHERE id = p_offer_id;
  IF NOT FOUND THEN
    action := 'error'; detail := 'offer_not_found';
    response_id := NULL; snapshot_id := NULL;
    RETURN NEXT; RETURN;
  END IF;

  IF v_offer.position_id IS NULL THEN
    action := 'blocked'; detail := 'offer_position_id_null';
    response_id := NULL; snapshot_id := NULL;
    RETURN NEXT; RETURN;
  END IF;

  SELECT * INTO v_op
    FROM public.operational_positions
   WHERE position_id = v_offer.position_id;
  IF NOT FOUND THEN
    action := 'blocked'; detail := 'operational_position_missing';
    response_id := NULL; snapshot_id := NULL;
    RETURN NEXT; RETURN;
  END IF;

  -- Pre-decision silent withdrawal of PENDING snapshots (unchanged)
  WITH del AS (
    DELETE FROM public.archive_promise_snapshots aps
     USING public.manager_offer_responses r
     WHERE aps.source = 'branch_response'
       AND aps.source_offer_id      = p_offer_id
       AND aps.source_response_id   = r.id
       AND aps.status               = 'pending'
       AND r.offer_id               = p_offer_id
       AND r.approved_pallets IS NULL
       AND r.refused_at       IS NULL
    RETURNING aps.snapshot_id, aps.source_response_id
  )
  SELECT count(*) INTO v_silent_del FROM del;

  IF v_silent_del > 0 THEN
    action := 'silent_withdrawn';
    detail := 'pending_snapshots_deleted=' || v_silent_del::text;
    response_id := NULL; snapshot_id := NULL;
    RETURN NEXT;
  END IF;

  -- Red archive per approved response (unchanged)
  FOR v_resp IN
    SELECT r.* FROM public.manager_offer_responses r
     WHERE r.offer_id = p_offer_id
  LOOP
    IF v_resp.refused_at IS NOT NULL THEN
      action := 'skipped'; detail := 'refused_response';
      response_id := v_resp.id; snapshot_id := NULL;
      RETURN NEXT; CONTINUE;
    END IF;
    IF v_resp.approved_pallets IS NULL OR v_resp.approved_pallets <= 0 THEN
      action := 'skipped'; detail := 'no_approved_pallets';
      response_id := v_resp.id; snapshot_id := NULL;
      RETURN NEXT; CONTINUE;
    END IF;

    SELECT * INTO v_existing
      FROM public.archive_promise_snapshots
     WHERE source_response_id = v_resp.id
       AND source = 'branch_response'
     ORDER BY created_at DESC
     LIMIT 1;

    IF FOUND THEN
      IF v_existing.status <> 'pending' THEN
        action := 'skipped';
        detail := 'snapshot_already_resolved:' || v_existing.resolution::text;
        response_id := v_resp.id; snapshot_id := v_existing.snapshot_id;
        RETURN NEXT; CONTINUE;
      END IF;
      v_snap_id := v_existing.snapshot_id;
    ELSE
      v_snap_id := gen_random_uuid();
      INSERT INTO public.archive_promise_snapshots (
        snapshot_id, position_id, branch_id, responsible_manager_id,
        source, source_offer_id, source_response_id, source_shipment_id,
        requested_qty, promise_eta_snapshot,
        product_id, product_origin_country_id, variety_id, caliber, packaging, pallet_qty,
        cost_indicative_usd_snapshot, cost_invoice_usd_snapshot,
        status, notes, created_at
      ) VALUES (
        v_snap_id, v_offer.position_id, v_resp.branch_id, v_offer.import_manager_id,
        'branch_response', v_offer.id, v_resp.id, NULL,
        v_resp.approved_pallets, v_offer.expected_eta,
        v_op.product_id, v_op.product_origin_country_id, v_op.variety_id,
        v_op.caliber, v_op.packaging, v_op.pallet_qty,
        v_offer.indicative_cost_usd, v_offer.invoice_cost_usd,
        'pending', p_reason, now()
      );
    END IF;

    FOR v_writer IN
      SELECT * FROM public.archive_write_cancelled_for_snapshot(v_snap_id, p_reason)
    LOOP
      action := v_writer.action;
      detail := COALESCE(v_writer.detail, '');
      response_id := v_resp.id; snapshot_id := v_snap_id;
      IF v_writer.action = 'error' THEN
        v_blocked := true;
      END IF;
      RETURN NEXT;
    END LOOP;
  END LOOP;

  IF v_blocked THEN
    action := 'error'; detail := 'archive_write_failed_status_not_changed';
    response_id := NULL; snapshot_id := NULL;
    RETURN NEXT; RETURN;
  END IF;

  -- Flip allocation parts and offer status (unchanged)
  UPDATE public.manager_offer_allocation_parts
     SET status = 'cancelled', updated_at = now()
   WHERE offer_id = p_offer_id
     AND status = 'ordered';

  UPDATE public.manager_offers
     SET status = 'deleted', updated_at = now()
   WHERE id = p_offer_id
     AND status <> 'deleted';

  -- Safe pre-work position rollback tail.
  -- Runs only when NO response is confirmed (approved_pallets>0)
  -- AND NO response is refused. Confirmed/refused keep the position
  -- as the red-archive anchor per rules 5/6.
  SELECT EXISTS (
    SELECT 1
      FROM public.manager_offer_responses r
     WHERE r.offer_id = p_offer_id
       AND ((r.approved_pallets IS NOT NULL AND r.approved_pallets > 0)
            OR r.refused_at IS NOT NULL)
  ) INTO v_has_decided;

  IF NOT v_has_decided THEN
    SELECT COUNT(*) INTO v_ship_item_count
      FROM public.shipment_items WHERE position_id = v_offer.position_id;
    SELECT COUNT(*) INTO v_alloc_count
      FROM public.manager_offer_allocation_parts
     WHERE position_id = v_offer.position_id;
    BEGIN
      SELECT COUNT(*) INTO v_link_count
        FROM public.position_shipment_links
       WHERE position_id = v_offer.position_id;
    EXCEPTION WHEN undefined_table THEN
      v_link_count := 0;
    END;

    IF v_ship_item_count = 0
       AND v_alloc_count = 0
       AND v_link_count  = 0 THEN

      v_saved_position := v_offer.position_id;

      -- Temporarily drop this offer's own reference so rollback_birth's
      -- manager_offers-count guard passes.
      UPDATE public.manager_offers
         SET position_id = NULL, updated_at = now()
       WHERE id = p_offer_id;

      SELECT rolled_back, reason
        INTO v_rb_ok, v_rb_reason
        FROM public.rpc_position_rollback_birth(v_saved_position);

      IF v_rb_ok THEN
        action := 'position_rolled_back';
        detail := 'position=' || v_saved_position::text;
        response_id := NULL; snapshot_id := NULL;
        RETURN NEXT;
      ELSE
        -- rpc_position_rollback_birth signals failure by return value
        -- (no exception), so we MUST explicitly restore the reference.
        UPDATE public.manager_offers
           SET position_id = v_saved_position, updated_at = now()
         WHERE id = p_offer_id;

        action := 'position_rollback_skipped';
        detail := COALESCE(v_rb_reason, 'unknown_reason');
        response_id := NULL; snapshot_id := NULL;
        RETURN NEXT;
      END IF;
    ELSE
      action := 'position_rollback_skipped';
      detail := 'downstream_links_present';
      response_id := NULL; snapshot_id := NULL;
      RETURN NEXT;
    END IF;
  END IF;

  action := 'ok'; detail := 'offer_cancelled';
  response_id := NULL; snapshot_id := NULL;
  RETURN NEXT;
  RETURN;
END;
$function$;
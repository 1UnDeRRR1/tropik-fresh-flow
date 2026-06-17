CREATE OR REPLACE FUNCTION public.archive_cancel_manager_offer(p_offer_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS TABLE(action text, detail text, response_id uuid, snapshot_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_offer       public.manager_offers%ROWTYPE;
  v_resp        RECORD;
  v_snap_id     uuid;
  v_existing    public.archive_promise_snapshots%ROWTYPE;
  v_op          public.operational_positions%ROWTYPE;
  v_writer      RECORD;
  v_blocked     boolean := false;
  v_silent_del  integer := 0;
BEGIN
  IF p_offer_id IS NULL THEN
    RAISE EXCEPTION 'p_offer_id is required';
  END IF;

  SELECT * INTO v_offer FROM public.manager_offers WHERE id = p_offer_id;
  IF NOT FOUND THEN
    action := 'error'; detail := 'offer_not_found'; response_id := NULL; snapshot_id := NULL;
    RETURN NEXT; RETURN;
  END IF;

  IF v_offer.position_id IS NULL THEN
    action := 'blocked'; detail := 'offer_position_id_null'; response_id := NULL; snapshot_id := NULL;
    RETURN NEXT; RETURN;
  END IF;

  SELECT * INTO v_op FROM public.operational_positions WHERE position_id = v_offer.position_id;
  IF NOT FOUND THEN
    action := 'blocked'; detail := 'operational_position_missing'; response_id := NULL; snapshot_id := NULL;
    RETURN NEXT; RETURN;
  END IF;

  -- Pre-decision silent withdrawal:
  -- For each branch response that is still undecided (no approval, no refusal)
  -- delete its PENDING branch_response snapshot for THIS offer. Strict scope:
  -- source='branch_response' + source_offer_id + source_response_id +
  -- status='pending' + paired with an undecided response. Never deletes
  -- resolved/refused/confirmed-then-cancelled snapshots. Never broadens to
  -- position_id. Idempotent: if nothing pending, no-op.
  WITH del AS (
    DELETE FROM public.archive_promise_snapshots aps
     USING public.manager_offer_responses r
     WHERE aps.source = 'branch_response'
       AND aps.source_offer_id = p_offer_id
       AND aps.source_response_id = r.id
       AND aps.status = 'pending'
       AND r.offer_id = p_offer_id
       AND r.approved_pallets IS NULL
       AND r.refused_at IS NULL
    RETURNING aps.snapshot_id, aps.source_response_id
  )
  SELECT count(*) INTO v_silent_del FROM del;

  IF v_silent_del > 0 THEN
    action := 'silent_withdrawn';
    detail := 'pending_snapshots_deleted=' || v_silent_del::text;
    response_id := NULL; snapshot_id := NULL;
    RETURN NEXT;
  END IF;

  FOR v_resp IN
    SELECT r.*
      FROM public.manager_offer_responses r
     WHERE r.offer_id = p_offer_id
  LOOP
    IF v_resp.refused_at IS NOT NULL THEN
      action := 'skipped'; detail := 'refused_response'; response_id := v_resp.id; snapshot_id := NULL;
      RETURN NEXT; CONTINUE;
    END IF;
    IF v_resp.approved_pallets IS NULL OR v_resp.approved_pallets <= 0 THEN
      action := 'skipped'; detail := 'no_approved_pallets'; response_id := v_resp.id; snapshot_id := NULL;
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
        action := 'skipped'; detail := 'snapshot_already_resolved:' || v_existing.resolution::text;
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
        v_op.product_id, v_op.product_origin_country_id, v_op.variety_id, v_op.caliber, v_op.packaging, v_op.pallet_qty,
        v_offer.indicative_cost_usd, v_offer.invoice_cost_usd,
        'pending', p_reason, now()
      );
    END IF;

    FOR v_writer IN
      SELECT * FROM public.archive_write_cancelled_for_snapshot(v_snap_id, p_reason)
    LOOP
      action := v_writer.action;
      detail := COALESCE(v_writer.detail, '');
      response_id := v_resp.id;
      snapshot_id := v_snap_id;
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

  UPDATE public.manager_offer_allocation_parts
     SET status = 'cancelled', updated_at = now()
   WHERE offer_id = p_offer_id
     AND status = 'ordered';

  UPDATE public.manager_offers
     SET status = 'deleted', updated_at = now()
   WHERE id = p_offer_id
     AND status <> 'deleted';

  action := 'ok'; detail := 'offer_cancelled'; response_id := NULL; snapshot_id := NULL;
  RETURN NEXT;
  RETURN;
END;
$function$;
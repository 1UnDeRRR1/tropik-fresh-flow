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
  v_offer       public.manager_offers%ROWTYPE;
  v_resp        RECORD;
  v_snap_id     uuid;
  v_existing    public.archive_promise_snapshots%ROWTYPE;
  v_op          public.operational_positions%ROWTYPE;
  v_writer      RECORD;
  v_blocked     boolean := false;
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
    -- No anchor → cannot snapshot. Report and stop, do not flip status.
    action := 'blocked'; detail := 'offer_position_id_null'; response_id := NULL; snapshot_id := NULL;
    RETURN NEXT; RETURN;
  END IF;

  SELECT * INTO v_op FROM public.operational_positions WHERE position_id = v_offer.position_id;
  IF NOT FOUND THEN
    action := 'blocked'; detail := 'operational_position_missing'; response_id := NULL; snapshot_id := NULL;
    RETURN NEXT; RETURN;
  END IF;

  FOR v_resp IN
    SELECT r.*
      FROM public.manager_offer_responses r
     WHERE r.offer_id = p_offer_id
  LOOP
    -- Skip non-confirmed promises
    IF v_resp.refused_at IS NOT NULL THEN
      action := 'skipped'; detail := 'refused_response'; response_id := v_resp.id; snapshot_id := NULL;
      RETURN NEXT; CONTINUE;
    END IF;
    IF v_resp.approved_pallets IS NULL OR v_resp.approved_pallets <= 0 THEN
      action := 'skipped'; detail := 'no_approved_pallets'; response_id := v_resp.id; snapshot_id := NULL;
      RETURN NEXT; CONTINUE;
    END IF;

    -- Reuse existing snapshot for this response if any
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
      -- Create snapshot via existing enum value 'branch_response'
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

    -- Write cancelled event (idempotent inside writer)
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

  -- Mark allocation parts cancelled (text column, no enum change)
  UPDATE public.manager_offer_allocation_parts
     SET status = 'cancelled', updated_at = now()
   WHERE offer_id = p_offer_id
     AND status = 'ordered';

  -- Flip offer status last (idempotent for already-deleted)
  UPDATE public.manager_offers
     SET status = 'deleted', updated_at = now()
   WHERE id = p_offer_id
     AND status <> 'deleted';

  action := 'ok'; detail := 'offer_cancelled'; response_id := NULL; snapshot_id := NULL;
  RETURN NEXT;
  RETURN;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.archive_cancel_manager_offer(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.archive_cancel_manager_offer(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.archive_cancel_manager_offer(uuid, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.archive_cancel_manager_offer(uuid, text) TO service_role;
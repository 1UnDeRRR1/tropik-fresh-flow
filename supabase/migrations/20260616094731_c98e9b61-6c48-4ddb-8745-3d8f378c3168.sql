-- Build A: cancelled archive writers + isolated resolver fallback pass.
-- No enum changes (cancelled already present in archive_visible_event_type,
-- archive_snapshot_resolution, archive_snapshot_status, shipment_status).
-- No table DDL. No RLS / GRANT on tables. No changes to existing functions.

-- ============================================================================
-- 1) archive_write_cancelled_for_shipment(p_shipment_id, p_reason)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.archive_write_cancelled_for_shipment(
  p_shipment_id uuid,
  p_reason      text DEFAULT NULL
)
RETURNS TABLE(snapshot_id uuid, action text, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_snap        public.archive_promise_snapshots%ROWTYPE;
  v_qty         numeric;
  v_approved    numeric;
  v_result_id   uuid;
  v_inserted    boolean;
BEGIN
  IF p_shipment_id IS NULL THEN
    RAISE EXCEPTION 'p_shipment_id is required';
  END IF;

  FOR v_snap IN
    SELECT DISTINCT s.*
      FROM public.archive_promise_snapshots s
     WHERE s.status = 'pending'
       AND (
            -- (a) snapshot was created against this shipment directly
            s.source_shipment_id = p_shipment_id
            -- (b) offer behind the snapshot is linked to this shipment
         OR s.source_offer_id IN (
              SELECT l.shipment_id IS NOT NULL AND l.shipment_id = p_shipment_id
              FROM public.manager_offer_shipment_links l
              WHERE l.shipment_id = p_shipment_id
              GROUP BY l.offer_id
            )
         OR s.source_offer_id IN (
              SELECT l.offer_id
                FROM public.manager_offer_shipment_links l
               WHERE l.shipment_id = p_shipment_id
            )
            -- (c) offer's linked_shipment_id directly points here
         OR s.source_offer_id IN (
              SELECT mo.id
                FROM public.manager_offers mo
               WHERE mo.linked_shipment_id = p_shipment_id
            )
       )
  LOOP
    -- Cancelled quantity rule:
    --   approved_pallets > 0 if the related response has one;
    --   else snapshot.requested_qty.
    v_approved := NULL;
    IF v_snap.source_response_id IS NOT NULL THEN
      SELECT r.approved_pallets
        INTO v_approved
        FROM public.manager_offer_responses r
       WHERE r.id = v_snap.source_response_id;
    END IF;

    IF v_approved IS NOT NULL AND v_approved > 0 THEN
      v_qty := v_approved;
    ELSE
      v_qty := COALESCE(v_snap.requested_qty, 0);
    END IF;

    v_result_id := gen_random_uuid();
    v_inserted  := false;

    -- Idempotent insert via partial unique index
    --   bar_unique_per_snapshot_shipment(snapshot_id, event_type, shipment_id)
    --     WHERE shipment_id IS NOT NULL
    INSERT INTO public.branch_archive_results (
      result_id, snapshot_id, position_id, branch_id, responsible_manager_id,
      event_type, event_qty, delivered_qty, shared_qty, cut_qty,
      actual_eta, is_split_shipment, shipment_id, occurred_at, created_at, notes
    ) VALUES (
      v_result_id, v_snap.snapshot_id, v_snap.position_id, v_snap.branch_id,
      v_snap.responsible_manager_id,
      'cancelled', v_qty, 0, 0, 0,
      NULL, false, p_shipment_id, now(), now(), p_reason
    )
    ON CONFLICT DO NOTHING
    RETURNING true INTO v_inserted;

    IF v_inserted IS NULL THEN
      -- Row already existed; recover its id for the snapshot pointer.
      SELECT r.result_id
        INTO v_result_id
        FROM public.branch_archive_results r
       WHERE r.snapshot_id = v_snap.snapshot_id
         AND r.event_type  = 'cancelled'
         AND r.shipment_id = p_shipment_id
       LIMIT 1;
    END IF;

    -- Resolve the snapshot (only if still pending; concurrent runs safe).
    UPDATE public.archive_promise_snapshots
       SET status                  = 'resolved',
           resolution              = 'cancelled',
           resolved_at             = now(),
           visible_archive_event_id = v_result_id
     WHERE snapshot_id = v_snap.snapshot_id
       AND status      = 'pending';

    snapshot_id := v_snap.snapshot_id;
    action      := 'cancelled';
    detail      := CASE WHEN v_inserted IS TRUE THEN 'inserted' ELSE 'already_present' END;
    RETURN NEXT;
  END LOOP;
END
$$;

REVOKE EXECUTE ON FUNCTION public.archive_write_cancelled_for_shipment(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.archive_write_cancelled_for_shipment(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.archive_write_cancelled_for_shipment(uuid, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.archive_write_cancelled_for_shipment(uuid, text) TO service_role;


-- ============================================================================
-- 2) archive_write_cancelled_for_snapshot(p_snapshot_id, p_reason)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.archive_write_cancelled_for_snapshot(
  p_snapshot_id uuid,
  p_reason      text DEFAULT NULL
)
RETURNS TABLE(snapshot_id uuid, action text, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_snap        public.archive_promise_snapshots%ROWTYPE;
  v_qty         numeric;
  v_approved    numeric;
  v_result_id   uuid;
  v_inserted    boolean;
BEGIN
  IF p_snapshot_id IS NULL THEN
    RAISE EXCEPTION 'p_snapshot_id is required';
  END IF;

  SELECT *
    INTO v_snap
    FROM public.archive_promise_snapshots
   WHERE archive_promise_snapshots.snapshot_id = p_snapshot_id;

  IF NOT FOUND THEN
    snapshot_id := p_snapshot_id;
    action      := 'skipped';
    detail      := 'snapshot_not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_snap.status <> 'pending' THEN
    snapshot_id := p_snapshot_id;
    action      := 'skipped';
    detail      := 'snapshot_not_pending';
    RETURN NEXT;
    RETURN;
  END IF;

  v_approved := NULL;
  IF v_snap.source_response_id IS NOT NULL THEN
    SELECT r.approved_pallets
      INTO v_approved
      FROM public.manager_offer_responses r
     WHERE r.id = v_snap.source_response_id;
  END IF;

  IF v_approved IS NOT NULL AND v_approved > 0 THEN
    v_qty := v_approved;
  ELSE
    v_qty := COALESCE(v_snap.requested_qty, 0);
  END IF;

  v_result_id := gen_random_uuid();
  v_inserted  := false;

  -- Idempotent via bar_unique_per_snapshot_no_shipment(snapshot_id, event_type)
  --   WHERE shipment_id IS NULL
  INSERT INTO public.branch_archive_results (
    result_id, snapshot_id, position_id, branch_id, responsible_manager_id,
    event_type, event_qty, delivered_qty, shared_qty, cut_qty,
    actual_eta, is_split_shipment, shipment_id, occurred_at, created_at, notes
  ) VALUES (
    v_result_id, v_snap.snapshot_id, v_snap.position_id, v_snap.branch_id,
    v_snap.responsible_manager_id,
    'cancelled', v_qty, 0, 0, 0,
    NULL, false, NULL, now(), now(), p_reason
  )
  ON CONFLICT DO NOTHING
  RETURNING true INTO v_inserted;

  IF v_inserted IS NULL THEN
    SELECT r.result_id
      INTO v_result_id
      FROM public.branch_archive_results r
     WHERE r.snapshot_id = v_snap.snapshot_id
       AND r.event_type  = 'cancelled'
       AND r.shipment_id IS NULL
     LIMIT 1;
  END IF;

  UPDATE public.archive_promise_snapshots
     SET status                  = 'resolved',
         resolution              = 'cancelled',
         resolved_at             = now(),
         visible_archive_event_id = v_result_id
   WHERE archive_promise_snapshots.snapshot_id = v_snap.snapshot_id
     AND status = 'pending';

  snapshot_id := v_snap.snapshot_id;
  action      := 'cancelled';
  detail      := CASE WHEN v_inserted IS TRUE THEN 'inserted' ELSE 'already_present' END;
  RETURN NEXT;
END
$$;

REVOKE EXECUTE ON FUNCTION public.archive_write_cancelled_for_snapshot(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.archive_write_cancelled_for_snapshot(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.archive_write_cancelled_for_snapshot(uuid, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.archive_write_cancelled_for_snapshot(uuid, text) TO service_role;


-- ============================================================================
-- 3) archive_resolver_cancelled_pass(p_snapshot_id)
--    Isolated fallback "Pass 0" implemented as a separate function so the
--    existing 300-line archive_resolver_run body (delivered / not_fulfilled /
--    refused / split logic) is NOT touched. Can be called independently or
--    invoked before archive_resolver_run in a future Build/scheduler.
--
--    Safe conditions per spec:
--      - snapshot.status = 'pending'
--      - snapshot.source = 'branch_response'
--      - related manager_offers.status = 'deleted'
--        (this is the only "deleted/cancelled" label in enum manager_offer_status,
--         enum values: draft, active, in_work, confirmed, linked, closed, expired, deleted)
--      - no live manager_offer_shipment_links rows for that offer
--      - no delivery evidence in branch_archive_results (delivered/shared) for the snapshot
-- ============================================================================
CREATE OR REPLACE FUNCTION public.archive_resolver_cancelled_pass(
  p_snapshot_id uuid DEFAULT NULL
)
RETURNS TABLE(snapshot_id uuid, action text, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_snap         public.archive_promise_snapshots%ROWTYPE;
  v_link_count   integer;
  v_evidence     integer;
  v_inner        record;
BEGIN
  FOR v_snap IN
    SELECT s.*
      FROM public.archive_promise_snapshots s
      JOIN public.manager_offers mo ON mo.id = s.source_offer_id
     WHERE s.status = 'pending'
       AND s.source = 'branch_response'
       AND mo.status = 'deleted'
       AND (p_snapshot_id IS NULL OR s.snapshot_id = p_snapshot_id)
     ORDER BY s.created_at
  LOOP
    SELECT COUNT(*) INTO v_link_count
      FROM public.manager_offer_shipment_links l
     WHERE l.offer_id = v_snap.source_offer_id;

    IF v_link_count > 0 THEN
      snapshot_id := v_snap.snapshot_id;
      action      := 'skipped';
      detail      := 'live_shipment_links_exist';
      RETURN NEXT;
      CONTINUE;
    END IF;

    SELECT COUNT(*) INTO v_evidence
      FROM public.branch_archive_results r
     WHERE r.snapshot_id = v_snap.snapshot_id
       AND r.event_type IN ('delivered', 'shared');

    IF v_evidence > 0 THEN
      snapshot_id := v_snap.snapshot_id;
      action      := 'skipped';
      detail      := 'delivery_evidence_present';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Delegate the actual write/resolve to the single-snapshot writer so the
    -- quantity rule and idempotency logic live in exactly one place.
    FOR v_inner IN
      SELECT * FROM public.archive_write_cancelled_for_snapshot(
        v_snap.snapshot_id,
        'resolver_pass: manager_offer.status=deleted, no live shipment links'
      )
    LOOP
      snapshot_id := v_inner.snapshot_id;
      action      := v_inner.action;
      detail      := v_inner.detail;
      RETURN NEXT;
    END LOOP;
  END LOOP;
END
$$;

REVOKE EXECUTE ON FUNCTION public.archive_resolver_cancelled_pass(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.archive_resolver_cancelled_pass(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.archive_resolver_cancelled_pass(uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.archive_resolver_cancelled_pass(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.archive_resolver_run(p_run_date date, p_snapshot_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(snapshot_id uuid, action text, detail text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_snap            archive_promise_snapshots%ROWTYPE;
  v_live_eta        date;
  v_shipment_id     uuid;
  v_live_pallets    numeric;
  v_candidate_count integer;
  v_req             branch_requests%ROWTYPE;
  v_result_id       uuid;
  v_inserted        boolean;
  v_cut             numeric;
BEGIN
  FOR v_snap IN
    SELECT *
      FROM public.archive_promise_snapshots s
     WHERE s.status = 'pending'
       AND s.source IN ('branch_response', 'branch_stock_request')
       AND (p_snapshot_id IS NULL OR s.snapshot_id = p_snapshot_id)
     ORDER BY s.created_at
  LOOP
    IF v_snap.source = 'branch_response' THEN

      WITH candidates AS (
        SELECT DISTINCT si.shipment_id, sh.eta
          FROM public.manager_offer_shipment_links l
          JOIN public.shipment_items si ON si.id = l.shipment_item_id
          LEFT JOIN public.shipments sh ON sh.id = si.shipment_id
         WHERE l.offer_id = v_snap.source_offer_id
           AND si.position_id = v_snap.position_id
      ),
      evidence AS (
        SELECT
          c.shipment_id,
          c.eta,
          COALESCE((
            SELECT SUM(di.pallets)
              FROM public.distribution_items di
              JOIN public.distributions d  ON d.id  = di.distribution_id
              JOIN public.shipment_items si ON si.id = di.shipment_item_id
             WHERE d.shipment_id  = c.shipment_id
               AND d.branch_id    = v_snap.branch_id
               AND si.position_id = v_snap.position_id
          ), 0) AS dist_pallets,
          COALESCE((
            SELECT SUM(p.pallets)
              FROM public.manager_offer_allocation_parts p
              JOIN public.shipment_items si ON si.id = p.shipment_item_id
             WHERE p.status         = 'ordered'
               AND p.shipment_id    = c.shipment_id
               AND p.branch_id      = v_snap.branch_id
               AND si.position_id   = v_snap.position_id
          ), 0) AS alloc_pallets
        FROM candidates c
      ),
      ranked AS (
        SELECT
          shipment_id,
          eta,
          CASE WHEN dist_pallets > 0 THEN dist_pallets ELSE alloc_pallets END AS live_pallets,
          (dist_pallets > 0 OR alloc_pallets > 0) AS has_evidence
        FROM evidence
      )
      SELECT
        COUNT(*) FILTER (WHERE has_evidence),
        (SELECT shipment_id  FROM ranked WHERE has_evidence LIMIT 2),
        (SELECT live_pallets FROM ranked WHERE has_evidence LIMIT 2)
      INTO v_candidate_count, v_shipment_id, v_live_pallets
      FROM ranked;

      SELECT MIN(sh.eta)
        INTO v_live_eta
        FROM public.manager_offer_shipment_links l
        JOIN public.shipment_items si ON si.id = l.shipment_item_id
        JOIN public.shipments sh      ON sh.id = si.shipment_id
       WHERE l.offer_id = v_snap.source_offer_id
         AND si.position_id = v_snap.position_id;

      IF v_live_eta IS NULL THEN
        SELECT mo.expected_eta INTO v_live_eta
          FROM public.manager_offers mo
         WHERE mo.id = v_snap.source_offer_id;
      END IF;

      IF v_live_eta IS NULL OR v_live_eta > p_run_date THEN
        snapshot_id := v_snap.snapshot_id;
        action := 'skipped';
        detail := 'eta_not_due';
        RETURN NEXT;
        CONTINUE;
      END IF;

      IF v_candidate_count > 1 THEN
        snapshot_id := v_snap.snapshot_id;
        action := 'deferred';
        detail := 'split_multiple_candidates';
        RETURN NEXT;
        CONTINUE;
      END IF;

      IF v_candidate_count = 1 THEN
        IF v_live_pallets > 0 THEN
          v_cut := GREATEST(COALESCE(v_snap.requested_qty,0) - v_live_pallets, 0);
          v_result_id := gen_random_uuid();
          v_inserted := false;

          INSERT INTO public.branch_archive_results (
            result_id, snapshot_id, position_id, branch_id, responsible_manager_id,
            event_type, event_qty, delivered_qty, shared_qty, cut_qty,
            actual_eta, is_split_shipment, shipment_id, occurred_at, created_at
          ) VALUES (
            v_result_id, v_snap.snapshot_id, v_snap.position_id, v_snap.branch_id,
            v_snap.responsible_manager_id,
            'delivered'::archive_visible_event_type,
            v_live_pallets, v_live_pallets, 0, v_cut,
            v_live_eta, false, v_shipment_id, now(), now()
          )
          ON CONFLICT DO NOTHING
          RETURNING true INTO v_inserted;

          IF v_inserted THEN
            UPDATE public.archive_promise_snapshots
               SET status = 'resolved'::archive_snapshot_status,
                   resolution = 'delivered'::archive_snapshot_resolution,
                   resolved_at = now(),
                   visible_archive_event_id = v_result_id
             WHERE archive_promise_snapshots.snapshot_id = v_snap.snapshot_id
               AND status = 'pending';

            snapshot_id := v_snap.snapshot_id;
            action := 'resolved';
            detail := 'delivered';
            RETURN NEXT;
          ELSE
            snapshot_id := v_snap.snapshot_id;
            action := 'noop';
            detail := 'delivered_already_present';
            RETURN NEXT;
          END IF;
          CONTINUE;
        ELSE
          snapshot_id := v_snap.snapshot_id;
          action := 'deferred';
          detail := 'reallocation_to_zero';
          RETURN NEXT;
          CONTINUE;
        END IF;
      END IF;

      v_result_id := gen_random_uuid();
      v_inserted := false;

      INSERT INTO public.branch_archive_results (
        result_id, snapshot_id, position_id, branch_id, responsible_manager_id,
        event_type, event_qty, delivered_qty, shared_qty, cut_qty,
        actual_eta, is_split_shipment, shipment_id, occurred_at, created_at
      ) VALUES (
        v_result_id, v_snap.snapshot_id, v_snap.position_id, v_snap.branch_id,
        v_snap.responsible_manager_id,
        'not_fulfilled'::archive_visible_event_type,
        COALESCE(v_snap.requested_qty,0), 0, 0, 0,
        v_live_eta, false, NULL, now(), now()
      )
      ON CONFLICT DO NOTHING
      RETURNING true INTO v_inserted;

      IF v_inserted THEN
        UPDATE public.archive_promise_snapshots
           SET status = 'resolved'::archive_snapshot_status,
               resolution = 'not_fulfilled'::archive_snapshot_resolution,
               resolved_at = now(),
               visible_archive_event_id = v_result_id
         WHERE archive_promise_snapshots.snapshot_id = v_snap.snapshot_id
           AND status = 'pending';

        snapshot_id := v_snap.snapshot_id;
        action := 'resolved';
        detail := 'not_fulfilled';
        RETURN NEXT;
      ELSE
        snapshot_id := v_snap.snapshot_id;
        action := 'noop';
        detail := 'not_fulfilled_already_present';
        RETURN NEXT;
      END IF;
      CONTINUE;
    END IF;

    IF v_snap.source = 'branch_stock_request' THEN
      SELECT * INTO v_req
        FROM public.branch_requests br
       WHERE br.id = v_snap.source_response_id;

      IF NOT FOUND THEN
        snapshot_id := v_snap.snapshot_id;
        action := 'skipped';
        detail := 'branch_request_missing';
        RETURN NEXT;
        CONTINUE;
      END IF;

      SELECT sh.eta INTO v_live_eta
        FROM public.shipments sh
       WHERE sh.id = COALESCE(v_req.shipment_id, v_snap.source_shipment_id);

      IF v_live_eta IS NULL OR v_live_eta > p_run_date THEN
        snapshot_id := v_snap.snapshot_id;
        action := 'skipped';
        detail := 'eta_not_due';
        RETURN NEXT;
        CONTINUE;
      END IF;

      IF v_req.status::text = 'pending' THEN
        snapshot_id := v_snap.snapshot_id;
        action := 'deferred';
        detail := 'br_pending';
        RETURN NEXT;
        CONTINUE;
      ELSIF v_req.status::text = 'rejected' THEN
        snapshot_id := v_snap.snapshot_id;
        action := 'skipped';
        detail := 'br_rejected_handled_by_s2';
        RETURN NEXT;
        CONTINUE;
      ELSIF v_req.status::text = 'cancelled' THEN
        snapshot_id := v_snap.snapshot_id;
        action := 'deferred';
        detail := 'br_cancelled';
        RETURN NEXT;
        CONTINUE;
      ELSIF v_req.status::text <> 'approved' THEN
        snapshot_id := v_snap.snapshot_id;
        action := 'deferred';
        detail := 'br_status_unhandled:'||v_req.status::text;
        RETURN NEXT;
        CONTINUE;
      END IF;

      IF v_req.approved_qty IS NULL OR v_req.approved_qty <= 0 THEN
        snapshot_id := v_snap.snapshot_id;
        action := 'skipped';
        detail := 'approved_qty_invalid';
        RETURN NEXT;
        CONTINUE;
      END IF;

      IF v_req.shipment_id IS NULL THEN
        snapshot_id := v_snap.snapshot_id;
        action := 'deferred';
        detail := 'br_no_shipment_id';
        RETURN NEXT;
        CONTINUE;
      END IF;

      v_cut := GREATEST(COALESCE(v_snap.requested_qty,0) - v_req.approved_qty, 0);
      v_result_id := gen_random_uuid();
      v_inserted := false;

      INSERT INTO public.branch_archive_results (
        result_id, snapshot_id, position_id, branch_id, responsible_manager_id,
        event_type, event_qty, delivered_qty, shared_qty, cut_qty,
        actual_eta, is_split_shipment, shipment_id, occurred_at, created_at
      ) VALUES (
        v_result_id, v_snap.snapshot_id, v_snap.position_id, v_snap.branch_id,
        v_snap.responsible_manager_id,
        'delivered'::archive_visible_event_type,
        v_req.approved_qty, v_req.approved_qty, 0, v_cut,
        v_live_eta, false, v_req.shipment_id, now(), now()
      )
      ON CONFLICT DO NOTHING
      RETURNING true INTO v_inserted;

      IF v_inserted THEN
        UPDATE public.archive_promise_snapshots
           SET status = 'resolved'::archive_snapshot_status,
               resolution = 'delivered'::archive_snapshot_resolution,
               resolved_at = now(),
               visible_archive_event_id = v_result_id
         WHERE archive_promise_snapshots.snapshot_id = v_snap.snapshot_id
           AND status = 'pending';

        snapshot_id := v_snap.snapshot_id;
        action := 'resolved';
        detail := 'delivered_from_branch_request';
        RETURN NEXT;
      ELSE
        snapshot_id := v_snap.snapshot_id;
        action := 'noop';
        detail := 'delivered_already_present';
        RETURN NEXT;
      END IF;
      CONTINUE;
    END IF;
  END LOOP;

  RETURN;
END;
$function$;
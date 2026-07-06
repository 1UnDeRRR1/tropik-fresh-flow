
CREATE OR REPLACE FUNCTION public.cancel_manager_offer_remaining(
  p_offer_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_offer public.manager_offers%ROWTYPE;
  v_is_admin boolean := false;
  v_owns boolean := false;
  v_mgr_id uuid;
  v_ordered_total numeric := 0;
  v_cancelled_before_total numeric := 0;
  v_approved_total numeric := 0;
  v_cancelled_inserted_total numeric := 0;
  v_inserted_count integer := 0;
  v_per_response jsonb := '[]'::jsonb;
  v_event_id uuid;
  r RECORD;
  v_remaining numeric;
  v_ordered numeric;
  v_cancelled numeric;
  v_approved numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_offer FROM public.manager_offers WHERE id = p_offer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Authorization: admin/super_admin OR owner/responsible manager.
  v_is_admin := public.has_role(v_uid, 'admin'::app_role)
             OR public.has_role(v_uid, 'super_admin'::app_role);

  IF NOT v_is_admin THEN
    SELECT id INTO v_mgr_id FROM public.import_managers WHERE user_id = v_uid LIMIT 1;
    v_owns := (v_offer.created_by = v_uid)
           OR (v_offer.import_manager_id = v_uid)
           OR (v_mgr_id IS NOT NULL AND v_offer.import_manager_id = v_mgr_id);
    IF NOT v_owns THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Guards
  IF v_offer.status IN ('deleted','expired') THEN
    RAISE EXCEPTION 'offer_status_invalid: %', v_offer.status USING ERRCODE = 'P0001';
  END IF;

  IF v_offer.position_id IS NULL THEN
    RAISE EXCEPTION 'offer_has_no_position' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(SUM(pallets), 0)
    INTO v_ordered_total
    FROM public.manager_offer_allocation_parts
   WHERE offer_id = p_offer_id AND status = 'ordered';

  IF v_ordered_total <= 0 THEN
    RAISE EXCEPTION 'no_ordered_pallets' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(SUM(pallets), 0)
    INTO v_cancelled_before_total
    FROM public.manager_offer_allocation_parts
   WHERE offer_id = p_offer_id AND status = 'cancelled';

  SELECT COALESCE(SUM(COALESCE(approved_pallets, 0)), 0)
    INTO v_approved_total
    FROM public.manager_offer_responses
   WHERE offer_id = p_offer_id;

  -- Per-response remainder cancellation
  FOR r IN
    SELECT id, branch_id, COALESCE(approved_pallets, 0) AS approved_pallets
      FROM public.manager_offer_responses
     WHERE offer_id = p_offer_id
  LOOP
    v_approved := r.approved_pallets;

    SELECT COALESCE(SUM(pallets), 0) INTO v_ordered
      FROM public.manager_offer_allocation_parts
     WHERE offer_id = p_offer_id
       AND response_id = r.id
       AND status = 'ordered';

    SELECT COALESCE(SUM(pallets), 0) INTO v_cancelled
      FROM public.manager_offer_allocation_parts
     WHERE offer_id = p_offer_id
       AND response_id = r.id
       AND status = 'cancelled';

    v_remaining := v_approved - v_ordered - v_cancelled;

    IF v_remaining > 0 THEN
      INSERT INTO public.manager_offer_allocation_parts (
        offer_id, response_id, branch_id, pallets, status,
        shipment_id, shipment_item_id, notes, created_by
      ) VALUES (
        p_offer_id, r.id, r.branch_id, v_remaining, 'cancelled',
        NULL, NULL,
        COALESCE(NULLIF(TRIM(p_reason), ''), 'Manager cancelled remaining unlinked quantity'),
        v_uid
      );

      v_cancelled_inserted_total := v_cancelled_inserted_total + v_remaining;
      v_inserted_count := v_inserted_count + 1;
      v_per_response := v_per_response || jsonb_build_object(
        'response_id', r.id,
        'branch_id', r.branch_id,
        'cancelled_pallets', v_remaining
      );
    END IF;
  END LOOP;

  IF v_inserted_count = 0 THEN
    -- No-op idempotent result
    RETURN jsonb_build_object(
      'ok', true,
      'no_op', true,
      'offer_id', p_offer_id,
      'position_id', v_offer.position_id,
      'approved_total', v_approved_total,
      'ordered_total', v_ordered_total,
      'cancelled_before_total', v_cancelled_before_total,
      'cancelled_inserted_total', 0,
      'cancelled_after_total', v_cancelled_before_total,
      'open_remaining_after', GREATEST(v_approved_total - v_ordered_total - v_cancelled_before_total, 0),
      'cancelled_responses', 0,
      'event_id', NULL,
      'per_response', '[]'::jsonb
    );
  END IF;

  INSERT INTO public.position_events (position_id, event_type, actor_id, payload)
  VALUES (
    v_offer.position_id,
    'remainder_cancelled',
    v_uid,
    jsonb_build_object(
      'offer_id', p_offer_id,
      'approved_total', v_approved_total,
      'ordered_total', v_ordered_total,
      'cancelled_before_total', v_cancelled_before_total,
      'cancelled_inserted_total', v_cancelled_inserted_total,
      'cancelled_after_total', v_cancelled_before_total + v_cancelled_inserted_total,
      'open_remaining_after', GREATEST(
        v_approved_total - v_ordered_total - (v_cancelled_before_total + v_cancelled_inserted_total),
        0
      ),
      'per_response', v_per_response,
      'reason', COALESCE(NULLIF(TRIM(p_reason), ''), 'Manager cancelled remaining unlinked quantity')
    )
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'ok', true,
    'no_op', false,
    'offer_id', p_offer_id,
    'position_id', v_offer.position_id,
    'approved_total', v_approved_total,
    'ordered_total', v_ordered_total,
    'cancelled_before_total', v_cancelled_before_total,
    'cancelled_inserted_total', v_cancelled_inserted_total,
    'cancelled_after_total', v_cancelled_before_total + v_cancelled_inserted_total,
    'open_remaining_after', GREATEST(
      v_approved_total - v_ordered_total - (v_cancelled_before_total + v_cancelled_inserted_total),
      0
    ),
    'cancelled_responses', v_inserted_count,
    'event_id', v_event_id,
    'per_response', v_per_response
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_manager_offer_remaining(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_manager_offer_remaining(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_manager_offer_remaining(uuid, text) TO service_role;

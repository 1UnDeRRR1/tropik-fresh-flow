-- ============================================================
-- A) Update rpc_position_create_draft to allow responsible-pending
--    leadership proposals for super_admin/admin (no supplier, no
--    selected manager). Block supplier-without-manager case.
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_position_create_draft(
  p_product_id uuid,
  p_product_origin_country_id uuid,
  p_source_context text DEFAULT NULL::text,
  p_source_row_key text DEFAULT NULL::text,
  p_client_row_id uuid DEFAULT NULL::uuid,
  p_variety_id bigint DEFAULT NULL::bigint,
  p_caliber text DEFAULT NULL::text,
  p_package_used text DEFAULT NULL::text,
  p_pallet_qty numeric DEFAULT NULL::numeric,
  p_supplier_id uuid DEFAULT NULL::uuid,
  p_free_description text DEFAULT NULL::text,
  p_responsible_manager_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(position_id uuid, created boolean, idempotency_status text, current_status text, owner_user_id uuid, created_by uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_actor_is_super boolean;
  v_actor_is_im boolean;
  v_resp_user uuid;
  v_resp_im_id uuid;
  v_responsible_pending boolean := false;
  v_leadership_created boolean := false;
  v_ctx text;
  v_key text;
  v_new_id uuid;
  v_existing record;
  v_payload_match boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid) THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = '28000';
  END IF;

  v_actor_is_super := public.has_role(v_uid, 'super_admin') OR public.has_role(v_uid, 'admin');
  v_actor_is_im    := public.has_role(v_uid, 'import_manager');

  IF NOT (v_actor_is_super OR v_actor_is_im) THEN
    RAISE EXCEPTION 'forbidden_role' USING ERRCODE = '42501';
  END IF;

  -- Resolve responsible manager / pending mode.
  IF v_actor_is_super THEN
    IF p_responsible_manager_id IS NOT NULL THEN
      -- on-behalf path
      SELECT im.id, im.user_id
        INTO v_resp_im_id, v_resp_user
      FROM public.import_managers im
      WHERE im.id = p_responsible_manager_id
        AND im.is_active = true
        AND im.user_id IS NOT NULL
      LIMIT 1;

      IF v_resp_user IS NULL THEN
        RAISE EXCEPTION 'invalid_responsible_manager' USING ERRCODE = '23503';
      END IF;
    ELSE
      -- responsible-pending leadership proposal:
      -- allowed ONLY when no supplier is provided. Do NOT silently
      -- assign supplier shipments to admin/super_admin.
      IF p_supplier_id IS NOT NULL THEN
        RAISE EXCEPTION 'supplier_manager_required' USING ERRCODE = '22023';
      END IF;
      v_resp_user := NULL;
      v_resp_im_id := NULL;
      v_responsible_pending := true;
      v_leadership_created := true;
    END IF;
  ELSE
    -- import_manager: must have active import_managers row linked to self.
    SELECT im.id, im.user_id
      INTO v_resp_im_id, v_resp_user
    FROM public.import_managers im
    WHERE im.user_id = v_uid
      AND im.is_active = true
    LIMIT 1;

    IF v_resp_user IS NULL THEN
      RAISE EXCEPTION 'import_manager_inactive' USING ERRCODE = '42501';
    END IF;

    IF p_responsible_manager_id IS NOT NULL
       AND p_responsible_manager_id <> v_resp_im_id THEN
      RAISE EXCEPTION 'forbidden_on_behalf' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- idempotency key normalization
  v_ctx := NULLIF(btrim(p_source_context), '');
  v_key := NULLIF(btrim(p_source_row_key), '');
  IF (v_ctx IS NULL) <> (v_key IS NULL) THEN
    RAISE EXCEPTION 'idempotency_partial_key' USING ERRCODE = '22023';
  END IF;

  -- required FK validation
  IF p_product_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.product_dictionary d WHERE d.id = p_product_id) THEN
    RAISE EXCEPTION 'invalid_product_id' USING ERRCODE = '23503';
  END IF;

  IF p_product_origin_country_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.countries c WHERE c.id = p_product_origin_country_id) THEN
    RAISE EXCEPTION 'invalid_country_id' USING ERRCODE = '23503';
  END IF;

  IF p_variety_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.product_varieties v WHERE v.id = p_variety_id) THEN
    RAISE EXCEPTION 'invalid_variety_id' USING ERRCODE = '23503';
  END IF;

  IF p_supplier_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.suppliers s WHERE s.id = p_supplier_id) THEN
    RAISE EXCEPTION 'invalid_supplier_id' USING ERRCODE = '23503';
  END IF;

  IF p_pallet_qty IS NOT NULL AND p_pallet_qty < 0 THEN
    RAISE EXCEPTION 'invalid_pallet_qty' USING ERRCODE = '22023';
  END IF;

  v_new_id := gen_random_uuid();

  BEGIN
    INSERT INTO public.operational_positions (
      position_id, product_id, product_origin_country_id, supplier_id,
      variety_id, caliber, packaging, pallet_qty,
      owner_user_id, created_by, current_status,
      source_context, source_row_key, client_row_id, notes
    ) VALUES (
      v_new_id, p_product_id, p_product_origin_country_id, p_supplier_id,
      p_variety_id, p_caliber, p_package_used, p_pallet_qty,
      v_resp_user, v_uid, 'draft',
      v_ctx, v_key, p_client_row_id, p_free_description
    );
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_existing
    FROM public.operational_positions op
    WHERE op.source_context = v_ctx AND op.source_row_key = v_key
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE;
    END IF;

    v_payload_match :=
      v_existing.product_id IS NOT DISTINCT FROM p_product_id
      AND v_existing.product_origin_country_id IS NOT DISTINCT FROM p_product_origin_country_id
      AND v_existing.supplier_id IS NOT DISTINCT FROM p_supplier_id
      AND v_existing.variety_id IS NOT DISTINCT FROM p_variety_id
      AND v_existing.caliber IS NOT DISTINCT FROM p_caliber
      AND v_existing.packaging IS NOT DISTINCT FROM p_package_used
      AND v_existing.pallet_qty IS NOT DISTINCT FROM p_pallet_qty
      AND v_existing.notes IS NOT DISTINCT FROM p_free_description
      AND v_existing.client_row_id IS NOT DISTINCT FROM p_client_row_id
      AND v_existing.owner_user_id IS NOT DISTINCT FROM v_resp_user;

    IF NOT v_payload_match THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = '23505';
    END IF;

    position_id := v_existing.position_id;
    created := false;
    idempotency_status := 'retry_match';
    current_status := v_existing.current_status;
    owner_user_id := v_existing.owner_user_id;
    created_by := v_existing.created_by;
    RETURN NEXT;
    RETURN;
  END;

  INSERT INTO public.position_events (position_id, event_type, payload, actor_id)
  VALUES (
    v_new_id,
    'created',
    jsonb_build_object(
      'lifecycle_stage', 'offer',
      'product_id', p_product_id,
      'product_origin_country_id', p_product_origin_country_id,
      'supplier_id', p_supplier_id,
      'variety_id', p_variety_id,
      'caliber', p_caliber,
      'packaging', p_package_used,
      'pallet_qty', p_pallet_qty,
      'source_context', v_ctx,
      'source_row_key', v_key,
      'client_row_id', p_client_row_id,
      'actor_user_id', v_uid,
      'responsible_manager_id', v_resp_im_id,
      'responsible_manager_user_id', v_resp_user,
      'responsible_pending', v_responsible_pending,
      'leadership_created', v_leadership_created,
      'on_behalf', (v_resp_user IS NOT NULL AND v_resp_user <> v_uid)
    ),
    v_uid
  );

  position_id := v_new_id;
  created := true;
  idempotency_status := 'created';
  current_status := 'draft';
  owner_user_id := v_resp_user;
  created_by := v_uid;
  RETURN NEXT;
  RETURN;
END;
$function$;


-- ============================================================
-- B) rpc_position_assign_responsible_manager
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_position_assign_responsible_manager(
  p_position_id uuid,
  p_responsible_manager_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_super boolean;
  v_is_admin boolean;
  v_is_branch boolean;
  v_is_broker boolean;
  v_is_logistics boolean;
  v_pos operational_positions%ROWTYPE;
  v_resp_user uuid;
  v_resp_im_id uuid;
  v_prev_owner uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;

  v_is_super     := public.has_role(v_uid, 'super_admin');
  v_is_admin     := public.has_role(v_uid, 'admin');
  v_is_branch    := public.has_role(v_uid, 'branch');
  v_is_broker    := public.has_role(v_uid, 'broker');
  v_is_logistics := public.has_role(v_uid, 'logistics');

  IF v_is_branch OR v_is_broker OR v_is_logistics THEN
    RAISE EXCEPTION 'forbidden_role' USING ERRCODE = '42501';
  END IF;

  IF NOT (v_is_super OR v_is_admin) THEN
    RAISE EXCEPTION 'forbidden_role' USING ERRCODE = '42501';
  END IF;

  IF p_position_id IS NULL THEN
    RAISE EXCEPTION 'invalid_position_id' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_pos
  FROM public.operational_positions
  WHERE position_id = p_position_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'position_not_found' USING ERRCODE = '23503';
  END IF;

  IF p_responsible_manager_id IS NULL THEN
    RAISE EXCEPTION 'responsible_manager_required' USING ERRCODE = '22023';
  END IF;

  SELECT im.id, im.user_id
    INTO v_resp_im_id, v_resp_user
  FROM public.import_managers im
  WHERE im.id = p_responsible_manager_id
    AND im.is_active = true
    AND im.user_id IS NOT NULL
  LIMIT 1;

  IF v_resp_user IS NULL THEN
    RAISE EXCEPTION 'invalid_responsible_manager' USING ERRCODE = '23503';
  END IF;

  IF NOT public.has_role(v_resp_user, 'import_manager') THEN
    RAISE EXCEPTION 'invalid_responsible_manager' USING ERRCODE = '23503';
  END IF;

  v_prev_owner := v_pos.owner_user_id;

  -- noop on same manager
  IF v_prev_owner IS NOT NULL AND v_prev_owner = v_resp_user THEN
    RETURN jsonb_build_object(
      'position_id', p_position_id,
      'status', 'noop',
      'previous_owner_user_id', v_prev_owner,
      'new_owner_user_id', v_resp_user,
      'responsible_manager_id', v_resp_im_id
    );
  END IF;

  UPDATE public.operational_positions
     SET owner_user_id = v_resp_user,
         updated_at = now()
   WHERE position_id = p_position_id;

  INSERT INTO public.position_events (position_id, event_type, payload, actor_id)
  VALUES (
    p_position_id,
    'responsible_manager_assigned',
    jsonb_build_object(
      'previous_owner_user_id', v_prev_owner,
      'new_owner_user_id', v_resp_user,
      'responsible_manager_id', v_resp_im_id,
      'actor_user_id', v_uid,
      'was_pending', (v_prev_owner IS NULL),
      'reason', p_reason
    ),
    v_uid
  );

  RETURN jsonb_build_object(
    'position_id', p_position_id,
    'status', CASE WHEN v_prev_owner IS NULL THEN 'assigned' ELSE 'reassigned' END,
    'previous_owner_user_id', v_prev_owner,
    'new_owner_user_id', v_resp_user,
    'responsible_manager_id', v_resp_im_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_position_assign_responsible_manager(uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_position_assign_responsible_manager(uuid, uuid, text) TO authenticated;

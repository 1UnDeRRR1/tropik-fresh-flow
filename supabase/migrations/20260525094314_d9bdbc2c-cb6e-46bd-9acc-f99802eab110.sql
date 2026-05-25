
CREATE OR REPLACE FUNCTION public.rpc_position_create_draft(
  p_product_id uuid,
  p_product_origin_country_id uuid,
  p_source_context text DEFAULT NULL,
  p_source_row_key text DEFAULT NULL,
  p_client_row_id uuid DEFAULT NULL,
  p_variety_id bigint DEFAULT NULL,
  p_caliber text DEFAULT NULL,
  p_package_used text DEFAULT NULL,
  p_pallet_qty numeric DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL,
  p_free_description text DEFAULT NULL
)
RETURNS TABLE (
  position_id uuid,
  created boolean,
  idempotency_status text,
  current_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ctx text;
  v_key text;
  v_new_id uuid;
  v_existing_id uuid;
  v_existing record;
  v_payload_match boolean;
BEGIN
  -- auth gate
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid) THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_staff(v_uid) THEN
    RAISE EXCEPTION 'forbidden_not_staff' USING ERRCODE = '42501';
  END IF;

  -- idempotency key normalization: trim; empty -> NULL
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

  -- optional FKs
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

  -- attempt insert; idempotency unique index handles race
  BEGIN
    INSERT INTO public.operational_positions (
      position_id, product_id, product_origin_country_id, supplier_id,
      variety_id, caliber, packaging, pallet_qty,
      owner_user_id, created_by, current_status,
      source_context, source_row_key, client_row_id, notes
    ) VALUES (
      v_new_id, p_product_id, p_product_origin_country_id, p_supplier_id,
      p_variety_id, p_caliber, p_package_used, p_pallet_qty,
      v_uid, v_uid, 'draft',
      v_ctx, v_key, p_client_row_id, p_free_description
    );
  EXCEPTION WHEN unique_violation THEN
    -- only idempotency index can collide (PK is fresh uuid)
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
      AND v_existing.client_row_id IS NOT DISTINCT FROM p_client_row_id;

    IF NOT v_payload_match THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = '23505';
    END IF;

    position_id := v_existing.position_id;
    created := false;
    idempotency_status := 'retry_match';
    current_status := v_existing.current_status;
    RETURN NEXT;
    RETURN;
  END;

  -- event only on fresh insert
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
      'client_row_id', p_client_row_id
    ),
    v_uid
  );

  position_id := v_new_id;
  created := true;
  idempotency_status := 'created';
  current_status := 'draft';
  RETURN NEXT;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_position_create_draft(
  uuid, uuid, text, text, uuid, bigint, text, text, numeric, uuid, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_position_create_draft(
  uuid, uuid, text, text, uuid, bigint, text, text, numeric, uuid, text
) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_position_create_draft(
  uuid, uuid, text, text, uuid, bigint, text, text, numeric, uuid, text
) TO authenticated;

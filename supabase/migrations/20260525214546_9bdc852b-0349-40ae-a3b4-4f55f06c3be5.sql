CREATE OR REPLACE FUNCTION public.rpc_position_attach_shipment(
  p_shipment_item_id uuid,
  p_position_id uuid,
  p_pallet_qty_linked numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_is_super boolean;
  v_is_admin boolean;
  v_is_import boolean;
  v_is_branch boolean;
  v_is_broker boolean;
  v_is_logistics boolean;
  v_si shipment_items%ROWTYPE;
  v_pos operational_positions%ROWTYPE;
  v_shipment_id uuid;
  v_ship_creator uuid;
  v_ship_manager uuid;
  v_qty numeric;
  v_link_id uuid;
  v_link_existing_qty numeric;
  v_event_id uuid;
  v_link_status text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  v_is_super     := public.has_role(v_actor, 'super_admin'::app_role);
  v_is_admin     := public.has_role(v_actor, 'admin'::app_role);
  v_is_import    := public.has_role(v_actor, 'import_manager'::app_role);
  v_is_branch    := public.has_role(v_actor, 'branch'::app_role);
  v_is_broker    := public.has_role(v_actor, 'broker'::app_role);
  v_is_logistics := public.has_role(v_actor, 'logistics'::app_role);

  IF v_is_branch OR v_is_broker OR v_is_logistics THEN
    RAISE EXCEPTION 'forbidden_role' USING ERRCODE = '42501';
  END IF;
  IF NOT (v_is_super OR v_is_admin OR v_is_import) THEN
    RAISE EXCEPTION 'forbidden_role' USING ERRCODE = '42501';
  END IF;

  -- Lock shipment_item
  SELECT * INTO v_si
    FROM public.shipment_items
   WHERE id = p_shipment_item_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shipment_item_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_shipment_id := v_si.shipment_id;

  -- Position
  SELECT * INTO v_pos
    FROM public.operational_positions
   WHERE position_id = p_position_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'position_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Resolve shipment owner/manager (best-effort; columns may be NULL)
  SELECT created_by, import_manager_id
    INTO v_ship_creator, v_ship_manager
    FROM public.shipments
   WHERE id = v_shipment_id;

  -- import_manager access: actor must be position owner/creator or shipment creator/manager
  IF v_is_import AND NOT (v_is_super OR v_is_admin) THEN
    IF v_pos.owner_user_id IS DISTINCT FROM v_actor
       AND v_pos.created_by IS DISTINCT FROM v_actor
       AND v_ship_creator IS DISTINCT FROM v_actor
       AND v_ship_manager IS DISTINCT FROM v_actor THEN
      RAISE EXCEPTION 'forbidden_not_accessible' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Resolve pallet_qty_linked
  v_qty := COALESCE(p_pallet_qty_linked, v_si.pallet_count);
  IF v_qty IS NULL OR v_qty <= 0 THEN
    RAISE EXCEPTION 'pallet_qty_required' USING ERRCODE = '23514';
  END IF;

  -- shipment_items.position_id conflict check (no overwrite)
  IF v_si.position_id IS NOT NULL AND v_si.position_id <> p_position_id THEN
    RAISE EXCEPTION 'shipment_item_already_attached_to_different_position'
      USING ERRCODE = '23505',
            DETAIL = format('shipment_item %s -> position %s', p_shipment_item_id, v_si.position_id);
  END IF;

  -- Lookup existing link for this (position, shipment)
  SELECT id, pallet_qty_linked
    INTO v_link_id, v_link_existing_qty
    FROM public.position_shipment_links
   WHERE position_id = p_position_id AND shipment_id = v_shipment_id
   ORDER BY created_at ASC
   LIMIT 1
   FOR UPDATE;

  -- Determine top-level idempotency
  IF v_si.position_id = p_position_id AND v_link_id IS NOT NULL THEN
    IF v_link_existing_qty = v_qty THEN
      RETURN jsonb_build_object(
        'status','noop',
        'shipment_item_id', p_shipment_item_id,
        'position_id', p_position_id,
        'shipment_id', v_shipment_id,
        'link_id', v_link_id
      );
    ELSE
      RAISE EXCEPTION 'shipment_link_qty_conflict'
        USING ERRCODE = '23505',
              DETAIL = format('existing qty=%s, requested qty=%s', v_link_existing_qty, v_qty);
    END IF;
  END IF;

  -- Apply: set shipment_items.position_id if NULL
  IF v_si.position_id IS NULL THEN
    UPDATE public.shipment_items
       SET position_id = p_position_id
     WHERE id = p_shipment_item_id
       AND position_id IS NULL;
  END IF;

  -- Insert link if missing
  IF v_link_id IS NULL THEN
    INSERT INTO public.position_shipment_links(position_id, shipment_id, pallet_qty_linked, created_by)
    VALUES (p_position_id, v_shipment_id, v_qty, v_actor)
    RETURNING id INTO v_link_id;
    v_link_status := 'link_created';
  ELSE
    -- link existed with same qty (covered above) — should not reach here in conflict path
    v_link_status := 'link_existed';
  END IF;

  -- Event (fresh attach only)
  INSERT INTO public.position_events(position_id, event_type, actor_id, payload)
  VALUES (
    p_position_id,
    'shipment_attached',
    v_actor,
    jsonb_build_object(
      'position_id', p_position_id,
      'shipment_id', v_shipment_id,
      'shipment_item_id', p_shipment_item_id,
      'pallet_qty_linked', v_qty,
      'actor_user_id', v_actor,
      'responsible_manager_id', NULL,
      'responsible_user_id', v_pos.owner_user_id,
      'on_behalf', (v_pos.owner_user_id IS NOT NULL AND v_pos.owner_user_id <> v_actor),
      'link_status', v_link_status
    )
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'status','attached',
    'shipment_item_id', p_shipment_item_id,
    'position_id', p_position_id,
    'shipment_id', v_shipment_id,
    'link_id', v_link_id,
    'pallet_qty_linked', v_qty,
    'event_id', v_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_position_attach_shipment(uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_position_attach_shipment(uuid, uuid, numeric) TO authenticated;
-- P2a: rpc_position_attach_offer
-- Attach an existing manager_offers shell row to an existing operational_positions.position_id.
-- position_id is the only product anchor. Nothing creates a new identity here.

CREATE OR REPLACE FUNCTION public.rpc_position_attach_offer(
  p_offer_id uuid,
  p_position_id uuid,
  p_responsible_manager_id uuid DEFAULT NULL
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
  v_offer manager_offers%ROWTYPE;
  v_pos operational_positions%ROWTYPE;
  v_event_id uuid;
  v_responsible_user_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  -- Role gates
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

  -- Validate position exists
  SELECT * INTO v_pos
    FROM public.operational_positions
   WHERE position_id = p_position_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'position_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Validate offer exists (lock to avoid race)
  SELECT * INTO v_offer
    FROM public.manager_offers
   WHERE id = p_offer_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotent no-op
  IF v_offer.position_id IS NOT NULL AND v_offer.position_id = p_position_id THEN
    RETURN jsonb_build_object(
      'status', 'noop',
      'offer_id', p_offer_id,
      'position_id', p_position_id
    );
  END IF;

  -- Conflict: already attached to different position
  IF v_offer.position_id IS NOT NULL AND v_offer.position_id <> p_position_id THEN
    RAISE EXCEPTION 'offer_already_attached_to_different_position'
      USING ERRCODE = '23505',
            DETAIL = format('offer %s is attached to position %s', p_offer_id, v_offer.position_id);
  END IF;

  -- import_manager must be either offer creator or position owner (own accessible flow)
  IF v_is_import AND NOT (v_is_super OR v_is_admin) THEN
    IF v_offer.created_by IS DISTINCT FROM v_actor
       AND v_pos.owner_user_id IS DISTINCT FROM v_actor
       AND v_pos.created_by IS DISTINCT FROM v_actor THEN
      RAISE EXCEPTION 'forbidden_not_accessible' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Responsible manager validation (consistency only; does not change owner_user_id)
  IF p_responsible_manager_id IS NOT NULL THEN
    SELECT user_id INTO v_responsible_user_id
      FROM public.import_managers
     WHERE id = p_responsible_manager_id AND is_active = true;
    IF v_pos.owner_user_id IS NOT NULL
       AND v_responsible_user_id IS NOT NULL
       AND v_pos.owner_user_id <> v_responsible_user_id THEN
      RAISE EXCEPTION 'responsible_manager_mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Attach
  UPDATE public.manager_offers
     SET position_id = p_position_id,
         updated_at = now()
   WHERE id = p_offer_id
     AND position_id IS NULL;

  -- Event
  INSERT INTO public.position_events (position_id, event_type, actor_id, payload)
  VALUES (
    p_position_id,
    'offer_attached',
    v_actor,
    jsonb_build_object(
      'offer_id', p_offer_id,
      'position_id', p_position_id,
      'actor_user_id', v_actor,
      'responsible_manager_id', p_responsible_manager_id,
      'responsible_user_id', COALESCE(v_responsible_user_id, v_pos.owner_user_id),
      'on_behalf', (v_pos.owner_user_id IS NOT NULL AND v_pos.owner_user_id <> v_actor)
    )
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'status', 'attached',
    'offer_id', p_offer_id,
    'position_id', p_position_id,
    'event_id', v_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_position_attach_offer(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_position_attach_offer(uuid, uuid, uuid) TO authenticated;
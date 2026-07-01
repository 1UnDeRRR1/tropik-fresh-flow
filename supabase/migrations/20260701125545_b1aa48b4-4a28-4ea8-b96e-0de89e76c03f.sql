
-- 1) Fix validation trigger: active must be strictly > 0, terminal statuses allow >= 0.
CREATE OR REPLACE FUNCTION public.vehicle_reserves_validate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'active' THEN
    IF NEW.pallets IS NULL OR NEW.pallets <= 0 THEN
      RAISE EXCEPTION 'pallets must be > 0 for active reserve' USING ERRCODE = '22023';
    END IF;
    IF NEW.gross_kg IS NULL OR NEW.gross_kg <= 0 THEN
      RAISE EXCEPTION 'gross_kg must be > 0 for active reserve' USING ERRCODE = '22023';
    END IF;
  ELSE
    -- released / closed / consumed: allow zero, forbid negative / null.
    IF NEW.pallets IS NULL OR NEW.pallets < 0 THEN
      RAISE EXCEPTION 'pallets must be >= 0' USING ERRCODE = '22023';
    END IF;
    IF NEW.gross_kg IS NULL OR NEW.gross_kg < 0 THEN
      RAISE EXCEPTION 'gross_kg must be >= 0' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NEW.pallets > 26 THEN
    RAISE EXCEPTION 'pallets cannot exceed 26' USING ERRCODE = '22023';
  END IF;
  IF NEW.gross_kg > 21500 THEN
    RAISE EXCEPTION 'gross_kg cannot exceed 21500' USING ERRCODE = '22023';
  END IF;

  IF NEW.status IN ('released','closed','consumed') AND NEW.closed_at IS NULL THEN
    NEW.closed_at := now();
  END IF;

  RETURN NEW;
END;
$function$;

-- 2) FIFO consume RPC for own active reserves of the caller.
CREATE OR REPLACE FUNCTION public.consume_vehicle_reserves_for_child(
  p_vehicle_id uuid,
  p_pallets    integer,
  p_gross_kg   numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid             uuid := auth.uid();
  v_vehicle_status  text;
  v_has_shipment    boolean;
  v_remaining_p     integer;
  v_remaining_g     numeric;
  v_take_p          integer;
  v_take_g          numeric;
  v_new_p           integer;
  v_new_g           numeric;
  v_consumed_ids    uuid[] := ARRAY[]::uuid[];
  v_consumed_p      integer := 0;
  v_consumed_g      numeric := 0;
  v_active_left     integer := 0;
  r                 record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'vehicle_id required' USING ERRCODE = '22023';
  END IF;
  IF p_pallets IS NULL OR p_pallets < 0 THEN
    RAISE EXCEPTION 'p_pallets must be >= 0' USING ERRCODE = '22023';
  END IF;
  IF p_gross_kg IS NULL OR p_gross_kg < 0 THEN
    RAISE EXCEPTION 'p_gross_kg must be >= 0' USING ERRCODE = '22023';
  END IF;

  -- No-op if nothing to consume.
  IF p_pallets = 0 AND p_gross_kg = 0 THEN
    RETURN jsonb_build_object(
      'consumed_reserve_ids', '[]'::jsonb,
      'consumed_pallets', 0,
      'consumed_gross_kg', 0,
      'remaining_active_count', (
        SELECT COUNT(*)::int FROM public.vehicle_reserves
         WHERE vehicle_id = p_vehicle_id
           AND owner_user_id = v_uid
           AND status = 'active'
      )
    );
  END IF;

  -- Advisory lock — same key as other reserve RPCs (2E-A).
  PERFORM pg_advisory_xact_lock(hashtextextended('vehicle:' || p_vehicle_id::text, 0));

  -- Vehicle must exist and be open.
  SELECT status::text INTO v_vehicle_status
    FROM public.vehicles
   WHERE id = p_vehicle_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vehicle_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_vehicle_status <> 'open' THEN
    RAISE EXCEPTION 'vehicle_not_open' USING ERRCODE = '22023';
  END IF;

  -- Caller must have a shipment in this vehicle (own or as import manager).
  SELECT EXISTS (
    SELECT 1
      FROM public.shipments s
      LEFT JOIN public.import_managers im ON im.id = s.import_manager_id
     WHERE s.vehicle_id = p_vehicle_id
       AND (
         s.created_by = v_uid
         OR im.user_id = v_uid
       )
  ) INTO v_has_shipment;
  IF NOT v_has_shipment THEN
    RAISE EXCEPTION 'forbidden: no shipment in this vehicle' USING ERRCODE = '42501';
  END IF;

  v_remaining_p := p_pallets;
  v_remaining_g := p_gross_kg;

  -- FIFO through caller's own active reserves for this vehicle.
  FOR r IN
    SELECT id, pallets, gross_kg
      FROM public.vehicle_reserves
     WHERE vehicle_id = p_vehicle_id
       AND owner_user_id = v_uid
       AND status = 'active'
     ORDER BY created_at ASC
     FOR UPDATE
  LOOP
    EXIT WHEN v_remaining_p <= 0 AND v_remaining_g <= 0;

    v_take_p := LEAST(r.pallets, v_remaining_p);
    v_take_g := LEAST(r.gross_kg, v_remaining_g);

    -- Guard against negative "take" if caller asked only for one axis.
    IF v_take_p < 0 THEN v_take_p := 0; END IF;
    IF v_take_g < 0 THEN v_take_g := 0; END IF;

    -- Skip reserves that would contribute nothing on either requested axis
    -- (avoid marking untouched reserves as consumed).
    IF v_take_p = 0 AND v_take_g = 0 THEN
      CONTINUE;
    END IF;

    v_new_p := r.pallets - v_take_p;
    v_new_g := r.gross_kg - v_take_g;

    IF v_new_p > 0 AND v_new_g > 0 THEN
      -- Partial consume: shrink reserve, keep active.
      UPDATE public.vehicle_reserves
         SET pallets    = v_new_p,
             gross_kg   = v_new_g,
             updated_at = now()
       WHERE id = r.id;
    ELSE
      -- Full consume: any axis <= 0 collapses the whole reserve to consumed.
      -- The actual amount subtracted equals what was left on the reserve
      -- (r.pallets / r.gross_kg), regardless of how much the caller still
      -- needs — never leave an active reserve with a zero axis.
      v_take_p := r.pallets;
      v_take_g := r.gross_kg;
      UPDATE public.vehicle_reserves
         SET status     = 'consumed',
             pallets    = 0,
             gross_kg   = 0,
             closed_at  = now(),
             updated_at = now()
       WHERE id = r.id;
      v_consumed_ids := v_consumed_ids || r.id;
    END IF;

    v_consumed_p := v_consumed_p + v_take_p;
    v_consumed_g := v_consumed_g + v_take_g;
    v_remaining_p := v_remaining_p - v_take_p;
    v_remaining_g := v_remaining_g - v_take_g;
  END LOOP;

  SELECT COUNT(*)::int INTO v_active_left
    FROM public.vehicle_reserves
   WHERE vehicle_id = p_vehicle_id
     AND owner_user_id = v_uid
     AND status = 'active';

  RETURN jsonb_build_object(
    'consumed_reserve_ids', to_jsonb(v_consumed_ids),
    'consumed_pallets', v_consumed_p,
    'consumed_gross_kg', v_consumed_g,
    'remaining_active_count', v_active_left
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_vehicle_reserves_for_child(uuid, integer, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_vehicle_reserves_for_child(uuid, integer, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.consume_vehicle_reserves_for_child(uuid, integer, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_vehicle_reserves_for_child(uuid, integer, numeric) TO service_role;


-- =========================================================
-- 2E-A: Vehicle Reserve DB foundation
-- =========================================================

-- 1. Enum
CREATE TYPE public.reserve_status AS ENUM ('active','consumed','released','closed');

-- 2. Table
CREATE TABLE public.vehicle_reserves (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id    uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE NO ACTION,
  pallets       integer NOT NULL,
  gross_kg      numeric(12,2) NOT NULL,
  status        public.reserve_status NOT NULL DEFAULT 'active',
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz
);

-- 3. Grants (before RLS)
GRANT SELECT ON public.vehicle_reserves TO authenticated;
GRANT ALL    ON public.vehicle_reserves TO service_role;

-- 4. RLS
ALTER TABLE public.vehicle_reserves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reserves_select_staff"
  ON public.vehicle_reserves
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'import_manager')
    OR public.has_role(auth.uid(), 'logistics')
  );

-- No INSERT / UPDATE / DELETE policies for authenticated. All writes via SECURITY DEFINER RPC.

-- 5. Indexes
CREATE INDEX vehicle_reserves_vehicle_active_idx
  ON public.vehicle_reserves (vehicle_id)
  WHERE status = 'active';

CREATE INDEX vehicle_reserves_owner_active_idx
  ON public.vehicle_reserves (owner_user_id)
  WHERE status = 'active';

-- 6. updated_at trigger
CREATE OR REPLACE FUNCTION public.vehicle_reserves_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_vehicle_reserves_set_updated_at
  BEFORE UPDATE ON public.vehicle_reserves
  FOR EACH ROW
  EXECUTE FUNCTION public.vehicle_reserves_set_updated_at();

-- 7. Validation trigger
CREATE OR REPLACE FUNCTION public.vehicle_reserves_validate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.pallets IS NULL OR NEW.pallets <= 0 THEN
    RAISE EXCEPTION 'pallets must be > 0' USING ERRCODE = '22023';
  END IF;
  IF NEW.gross_kg IS NULL OR NEW.gross_kg <= 0 THEN
    RAISE EXCEPTION 'gross_kg must be > 0' USING ERRCODE = '22023';
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
$$;

CREATE TRIGGER trg_vehicle_reserves_validate
  BEFORE INSERT OR UPDATE ON public.vehicle_reserves
  FOR EACH ROW
  EXECUTE FUNCTION public.vehicle_reserves_validate();

-- 8. Read-only capacity view for UI
CREATE OR REPLACE VIEW public.vehicle_capacity_v AS
SELECT
  v.id AS vehicle_id,
  26::int AS max_pallets,
  21500::numeric AS max_gross_kg,
  COALESCE(f.fact_pallets, 0)::int         AS fact_pallets,
  COALESCE(f.fact_gross_kg, 0)::numeric    AS fact_gross_kg,
  COALESCE(r.reserved_pallets, 0)::int     AS reserved_pallets,
  COALESCE(r.reserved_gross_kg, 0)::numeric AS reserved_gross_kg,
  GREATEST(0, 26 - COALESCE(f.fact_pallets, 0) - COALESCE(r.reserved_pallets, 0))::int
    AS free_pallets,
  GREATEST(0, 21500 - COALESCE(f.fact_gross_kg, 0) - COALESCE(r.reserved_gross_kg, 0))::numeric
    AS free_gross_kg
FROM public.vehicles v
LEFT JOIN (
  SELECT s.vehicle_id,
         SUM(COALESCE(si.pallet_count, 0))::int AS fact_pallets,
         SUM(
           COALESCE(
             si.gross_weight_kg,
             si.net_weight_kg,
             COALESCE(si.pallet_count, 0) * COALESCE(si.pallet_weight, 0)
           )
         )::numeric AS fact_gross_kg
  FROM public.shipment_items si
  JOIN public.shipments s ON s.id = si.shipment_id
  WHERE s.vehicle_id IS NOT NULL
  GROUP BY s.vehicle_id
) f ON f.vehicle_id = v.id
LEFT JOIN (
  SELECT vehicle_id,
         SUM(pallets)::int   AS reserved_pallets,
         SUM(gross_kg)::numeric AS reserved_gross_kg
  FROM public.vehicle_reserves
  WHERE status = 'active'
  GROUP BY vehicle_id
) r ON r.vehicle_id = v.id;

GRANT SELECT ON public.vehicle_capacity_v TO authenticated;

-- 9. Realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicle_reserves;

-- =========================================================
-- 10. RPC: create_vehicle_reserve
-- =========================================================
CREATE OR REPLACE FUNCTION public.create_vehicle_reserve(
  p_vehicle_id uuid,
  p_pallets    integer,
  p_gross_kg   numeric,
  p_note       text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid           uuid := auth.uid();
  v_vehicle_status text;
  v_fact_pallets  int;
  v_fact_gross    numeric;
  v_res_pallets   int;
  v_res_gross     numeric;
  v_free_pallets  int;
  v_free_gross    numeric;
  v_id            uuid;
BEGIN
  -- auth
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- inputs
  IF p_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'vehicle_id required' USING ERRCODE = '22023';
  END IF;
  IF p_pallets IS NULL OR p_pallets <= 0 THEN
    RAISE EXCEPTION 'pallets must be > 0' USING ERRCODE = '22023';
  END IF;
  IF p_gross_kg IS NULL OR p_gross_kg <= 0 THEN
    RAISE EXCEPTION 'gross_kg must be > 0' USING ERRCODE = '22023';
  END IF;
  IF p_pallets > 26 THEN
    RAISE EXCEPTION 'pallets cannot exceed 26' USING ERRCODE = '22023';
  END IF;
  IF p_gross_kg > 21500 THEN
    RAISE EXCEPTION 'gross_kg cannot exceed 21500' USING ERRCODE = '22023';
  END IF;

  -- role gate
  IF NOT (
    public.has_role(v_uid, 'super_admin')
    OR public.has_role(v_uid, 'admin')
    OR public.has_role(v_uid, 'import_manager')
  ) THEN
    RAISE EXCEPTION 'forbidden: role' USING ERRCODE = '42501';
  END IF;

  -- authorship guard for import_manager
  IF NOT (public.has_role(v_uid, 'super_admin') OR public.has_role(v_uid, 'admin')) THEN
    -- import_manager path
    IF NOT EXISTS (
      SELECT 1
      FROM public.shipments s
      LEFT JOIN public.import_managers im ON im.id = s.import_manager_id
      WHERE s.vehicle_id = p_vehicle_id
        AND (s.created_by = v_uid OR im.user_id = v_uid)
    ) THEN
      RAISE EXCEPTION 'forbidden: not your vehicle' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- advisory lock per vehicle (transaction-scoped)
  PERFORM pg_advisory_xact_lock(hashtextextended('vehicle:' || p_vehicle_id::text, 0));

  -- vehicle must exist and be open
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

  -- capacity: recompute directly from base tables (bypass RLS via SECURITY DEFINER)
  SELECT
    COALESCE(SUM(COALESCE(si.pallet_count, 0)), 0)::int,
    COALESCE(SUM(
      COALESCE(
        si.gross_weight_kg,
        si.net_weight_kg,
        COALESCE(si.pallet_count, 0) * COALESCE(si.pallet_weight, 0)
      )
    ), 0)::numeric
  INTO v_fact_pallets, v_fact_gross
  FROM public.shipment_items si
  JOIN public.shipments s ON s.id = si.shipment_id
  WHERE s.vehicle_id = p_vehicle_id;

  SELECT
    COALESCE(SUM(pallets), 0)::int,
    COALESCE(SUM(gross_kg), 0)::numeric
  INTO v_res_pallets, v_res_gross
  FROM public.vehicle_reserves
  WHERE vehicle_id = p_vehicle_id AND status = 'active';

  v_free_pallets := 26    - v_fact_pallets - v_res_pallets;
  v_free_gross   := 21500 - v_fact_gross   - v_res_gross;

  IF p_pallets > v_free_pallets THEN
    RAISE EXCEPTION 'capacity_exceeded_pallets: requested=%, free=%',
      p_pallets, v_free_pallets USING ERRCODE = '22023';
  END IF;
  IF p_gross_kg > v_free_gross THEN
    RAISE EXCEPTION 'capacity_exceeded_gross: requested=%, free=%',
      p_gross_kg, v_free_gross USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.vehicle_reserves (vehicle_id, owner_user_id, pallets, gross_kg, note)
  VALUES (p_vehicle_id, v_uid, p_pallets, p_gross_kg, NULLIF(TRIM(COALESCE(p_note,'')),''))
  RETURNING id INTO v_id;

  -- post-insert hard invariant (same tx)
  SELECT COALESCE(SUM(pallets),0)::int, COALESCE(SUM(gross_kg),0)::numeric
    INTO v_res_pallets, v_res_gross
  FROM public.vehicle_reserves
  WHERE vehicle_id = p_vehicle_id AND status = 'active';

  IF (v_fact_pallets + v_res_pallets) > 26 OR (v_fact_gross + v_res_gross) > 21500 THEN
    RAISE EXCEPTION 'capacity_invariant_violated' USING ERRCODE = '22023';
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_vehicle_reserve(uuid, integer, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_vehicle_reserve(uuid, integer, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_vehicle_reserve(uuid, integer, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_vehicle_reserve(uuid, integer, numeric, text) TO service_role;

-- =========================================================
-- 11. RPC: release_vehicle_reserve
-- =========================================================
CREATE OR REPLACE FUNCTION public.release_vehicle_reserve(
  p_reserve_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_r   public.vehicle_reserves%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_reserve_id IS NULL THEN
    RAISE EXCEPTION 'reserve_id required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_r
  FROM public.vehicle_reserves
  WHERE id = p_reserve_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reserve_not_found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('vehicle:' || v_r.vehicle_id::text, 0));

  -- authorization: owner or super_admin
  IF NOT (v_r.owner_user_id = v_uid OR public.has_role(v_uid, 'super_admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- lifecycle: no-op if not active
  IF v_r.status <> 'active' THEN
    RETURN;
  END IF;

  UPDATE public.vehicle_reserves
     SET status    = 'released',
         closed_at = now(),
         updated_at = now()
   WHERE id = p_reserve_id;
END;
$$;

REVOKE ALL ON FUNCTION public.release_vehicle_reserve(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_vehicle_reserve(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.release_vehicle_reserve(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_vehicle_reserve(uuid) TO service_role;

-- =========================================================
-- 12. RPC: close_vehicle_reserves
-- =========================================================
CREATE OR REPLACE FUNCTION public.close_vehicle_reserves(
  p_vehicle_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_status text;
  v_count  int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'vehicle_id required' USING ERRCODE = '22023';
  END IF;

  IF NOT (
    public.has_role(v_uid, 'super_admin')
    OR public.has_role(v_uid, 'admin')
    OR public.has_role(v_uid, 'import_manager')
  ) THEN
    RAISE EXCEPTION 'forbidden: role' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('vehicle:' || p_vehicle_id::text, 0));

  SELECT status::text INTO v_status
  FROM public.vehicles
  WHERE id = p_vehicle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'vehicle_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'closed' THEN
    RAISE EXCEPTION 'vehicle_not_closed' USING ERRCODE = '22023';
  END IF;

  WITH upd AS (
    UPDATE public.vehicle_reserves
       SET status = 'closed',
           closed_at = now(),
           updated_at = now()
     WHERE vehicle_id = p_vehicle_id
       AND status = 'active'
    RETURNING 1
  )
  SELECT COUNT(*)::int INTO v_count FROM upd;

  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.close_vehicle_reserves(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_vehicle_reserves(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.close_vehicle_reserves(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_vehicle_reserves(uuid) TO service_role;

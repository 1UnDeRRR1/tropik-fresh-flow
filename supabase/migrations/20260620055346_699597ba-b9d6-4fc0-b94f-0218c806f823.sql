-- Apply-1: Audit infrastructure for public.shipments
-- Creates shipment_changes table, indexes, RLS, grants, and log_shipments_changes() function.
-- Does NOT attach the trigger on public.shipments (Apply-2).

-- ============================================================
-- 1. Table: public.shipment_changes
-- ============================================================
CREATE TABLE IF NOT EXISTS public.shipment_changes (
  id              bigserial PRIMARY KEY,
  shipment_id     uuid NOT NULL,
  op              text NOT NULL CHECK (op IN ('INSERT','UPDATE','DELETE')),
  changed_fields  text[] NOT NULL DEFAULT '{}',
  old_values      jsonb,
  new_values      jsonb,

  -- actor (trusted, from auth.uid())
  actor_id        uuid,
  actor_roles     text[] NOT NULL DEFAULT '{}',

  -- trusted request context (from PostgREST headers / session)
  request_role    text,
  request_method  text,
  request_path    text,

  -- untrusted UI-provided context (client_*)
  client_source       text,
  client_action       text,
  client_route        text,
  client_request_id   text,

  -- DB transaction id (for correlation across multiple rows in same txn)
  txid            bigint NOT NULL DEFAULT txid_current(),

  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. GRANTs (service_role: SELECT only; no INSERT/UPDATE/DELETE)
-- ============================================================
REVOKE ALL ON public.shipment_changes FROM PUBLIC;
REVOKE ALL ON public.shipment_changes FROM anon;
REVOKE ALL ON public.shipment_changes FROM authenticated;
REVOKE ALL ON public.shipment_changes FROM service_role;

GRANT SELECT ON public.shipment_changes TO authenticated;
GRANT SELECT ON public.shipment_changes TO service_role;
-- Writes happen ONLY via the SECURITY DEFINER trigger function (owner = postgres).

REVOKE ALL ON SEQUENCE public.shipment_changes_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.shipment_changes_id_seq FROM anon;
REVOKE ALL ON SEQUENCE public.shipment_changes_id_seq FROM authenticated;
REVOKE ALL ON SEQUENCE public.shipment_changes_id_seq FROM service_role;

-- ============================================================
-- 3. RLS — SELECT only for super_admin
-- ============================================================
ALTER TABLE public.shipment_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_changes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shipment_changes_select_super_admin" ON public.shipment_changes;
CREATE POLICY "shipment_changes_select_super_admin"
  ON public.shipment_changes
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));

-- No INSERT / UPDATE / DELETE policies => no user can write or modify.

-- ============================================================
-- 4. Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS shipment_changes_shipment_id_created_at_idx
  ON public.shipment_changes (shipment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS shipment_changes_created_at_idx
  ON public.shipment_changes (created_at DESC);

CREATE INDEX IF NOT EXISTS shipment_changes_actor_id_idx
  ON public.shipment_changes (actor_id);

CREATE INDEX IF NOT EXISTS shipment_changes_txid_idx
  ON public.shipment_changes (txid);

CREATE INDEX IF NOT EXISTS shipment_changes_client_request_id_idx
  ON public.shipment_changes (client_request_id)
  WHERE client_request_id IS NOT NULL;

-- ============================================================
-- 5. Trigger function: public.log_shipments_changes()
--    - SECURITY DEFINER, search_path = ''
--    - AFTER row trigger => RETURN NULL
--    - Safe CASE for NEW/OLD by TG_OP
--    - changed_fields via jsonb_object_keys AS t(k), excluding updated_at
--    - client_* treated as untrusted (length-clamped, raw passthrough)
--    - request_role/method/path treated as trusted PostgREST context
--    - Fail-closed: any exception aborts the underlying statement
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_shipments_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old             jsonb;
  v_new             jsonb;
  v_changed         text[];
  v_shipment_id     uuid;
  v_actor_id        uuid;
  v_actor_roles     text[];
  v_request_role    text;
  v_request_method  text;
  v_request_path    text;
  v_client_source     text;
  v_client_action     text;
  v_client_route      text;
  v_client_request_id text;
  v_headers         jsonb;
BEGIN
  -- 1) OLD / NEW safe handling by op
  IF TG_OP = 'INSERT' THEN
    v_old := NULL;
    v_new := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
  ELSIF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
    v_new := NULL;
  ELSE
    -- Unknown TG_OP => fail-closed
    RAISE EXCEPTION 'log_shipments_changes: unexpected TG_OP %', TG_OP;
  END IF;

  -- 2) shipment_id (id column on public.shipments)
  v_shipment_id := COALESCE(
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN (v_new->>'id')::uuid END,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN (v_old->>'id')::uuid END
  );

  -- 3) changed_fields
  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(array_agg(t.k ORDER BY t.k), '{}')
      INTO v_changed
    FROM (
      SELECT k FROM jsonb_object_keys(v_new) AS t(k)
      UNION
      SELECT k FROM jsonb_object_keys(v_old) AS t(k)
    ) AS t(k)
    WHERE t.k <> 'updated_at'
      AND (v_new->t.k) IS DISTINCT FROM (v_old->t.k);

    -- No-op (only updated_at touched) => still log, with empty changed_fields.
  ELSIF TG_OP = 'INSERT' THEN
    SELECT COALESCE(array_agg(t.k ORDER BY t.k), '{}')
      INTO v_changed
    FROM jsonb_object_keys(v_new) AS t(k)
    WHERE t.k <> 'updated_at';
  ELSE -- DELETE
    SELECT COALESCE(array_agg(t.k ORDER BY t.k), '{}')
      INTO v_changed
    FROM jsonb_object_keys(v_old) AS t(k)
    WHERE t.k <> 'updated_at';
  END IF;

  -- 4) actor + roles (trusted, from auth context)
  BEGIN
    v_actor_id := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_actor_id := NULL;
  END;

  IF v_actor_id IS NOT NULL THEN
    SELECT COALESCE(array_agg(ur.role::text ORDER BY ur.role::text), '{}')
      INTO v_actor_roles
    FROM public.user_roles ur
    WHERE ur.user_id = v_actor_id;
  ELSE
    v_actor_roles := '{}';
  END IF;

  -- 5) Trusted request context
  BEGIN
    v_request_role   := current_setting('request.jwt.claim.role', true);
  EXCEPTION WHEN OTHERS THEN v_request_role := NULL;
  END;
  BEGIN
    v_request_method := current_setting('request.method', true);
  EXCEPTION WHEN OTHERS THEN v_request_method := NULL;
  END;
  BEGIN
    v_request_path   := current_setting('request.path', true);
  EXCEPTION WHEN OTHERS THEN v_request_path := NULL;
  END;

  -- 6) Untrusted client_* via request.headers (PostgREST)
  BEGIN
    v_headers := current_setting('request.headers', true)::jsonb;
  EXCEPTION WHEN OTHERS THEN
    v_headers := NULL;
  END;

  IF v_headers IS NOT NULL THEN
    v_client_source     := left(NULLIF(v_headers->>'x-audit-source', ''), 64);
    v_client_action     := left(NULLIF(v_headers->>'x-audit-action', ''), 128);
    v_client_route      := left(NULLIF(v_headers->>'x-audit-route',  ''), 256);
    v_client_request_id := left(NULLIF(v_headers->>'x-request-id',   ''), 64);
  END IF;

  -- 7) Insert audit row (writes succeed because function is SECURITY DEFINER, owner = postgres)
  INSERT INTO public.shipment_changes(
    shipment_id, op, changed_fields, old_values, new_values,
    actor_id, actor_roles,
    request_role, request_method, request_path,
    client_source, client_action, client_route, client_request_id
  )
  VALUES (
    v_shipment_id, TG_OP, v_changed, v_old, v_new,
    v_actor_id, v_actor_roles,
    v_request_role, v_request_method, v_request_path,
    v_client_source, v_client_action, v_client_route, v_client_request_id
  );

  -- AFTER row trigger
  RETURN NULL;
END;
$$;

-- ============================================================
-- 6. Hardening of the function
-- ============================================================
ALTER FUNCTION public.log_shipments_changes() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.log_shipments_changes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_shipments_changes() FROM anon;
REVOKE ALL ON FUNCTION public.log_shipments_changes() FROM authenticated;
-- Triggers invoke the function regardless of EXECUTE grants; no grants needed.

-- ============================================================
-- NOTE: trigger on public.shipments is intentionally NOT created here.
-- It will be enabled separately in Apply-2 as
--   zz_99_log_shipment_changes AFTER INSERT OR UPDATE OR DELETE ON public.shipments.
-- ============================================================

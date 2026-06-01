
-- 1) Table
CREATE TABLE public.user_activity_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz NULL,
  user_agent text NULL,
  platform text NULL,
  app_version text NULL,
  last_path text NULL,
  heartbeat_count integer NOT NULL DEFAULT 1,
  duration_seconds integer GENERATED ALWAYS AS (
    EXTRACT(EPOCH FROM (COALESCE(ended_at, last_seen_at) - started_at))::int
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2) Indexes
CREATE INDEX uas_user_started_idx ON public.user_activity_sessions (user_id, started_at DESC);
CREATE INDEX uas_open_idx ON public.user_activity_sessions (last_seen_at DESC) WHERE ended_at IS NULL;
CREATE INDEX uas_last_seen_idx ON public.user_activity_sessions (last_seen_at DESC);

-- 3) GRANTs (no anon — auth-only)
GRANT SELECT ON public.user_activity_sessions TO authenticated;
GRANT ALL ON public.user_activity_sessions TO service_role;

-- 4) RLS
ALTER TABLE public.user_activity_sessions ENABLE ROW LEVEL SECURITY;

-- Super admin can read everything
CREATE POLICY "uas super read"
  ON public.user_activity_sessions
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role));

-- User can read own sessions
CREATE POLICY "uas self read"
  ON public.user_activity_sessions
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Writes go through SECURITY DEFINER RPCs only; no direct INSERT/UPDATE/DELETE policies.

-- 5) RPCs

CREATE OR REPLACE FUNCTION public.rpc_activity_start_session(
  p_user_agent text DEFAULT NULL,
  p_platform text DEFAULT NULL,
  p_app_version text DEFAULT NULL,
  p_last_path text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.user_activity_sessions (
    user_id, user_agent, platform, app_version, last_path
  ) VALUES (
    v_uid,
    LEFT(COALESCE(p_user_agent, ''), 300),
    LEFT(COALESCE(p_platform, ''), 50),
    LEFT(COALESCE(p_app_version, ''), 50),
    LEFT(COALESCE(p_last_path, ''), 200)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_activity_heartbeat(
  p_session_id uuid,
  p_last_path text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.user_activity_sessions
     SET last_seen_at = now(),
         heartbeat_count = heartbeat_count + 1,
         last_path = COALESCE(LEFT(p_last_path, 200), last_path)
   WHERE id = p_session_id
     AND user_id = v_uid
     AND ended_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_activity_end_session(
  p_session_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.user_activity_sessions
     SET ended_at = now(),
         last_seen_at = now()
   WHERE id = p_session_id
     AND user_id = v_uid
     AND ended_at IS NULL;
END;
$$;

-- Super-admin only: close sessions that have been silent for >5 minutes
CREATE OR REPLACE FUNCTION public.rpc_activity_close_stale()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  UPDATE public.user_activity_sessions
     SET ended_at = last_seen_at
   WHERE ended_at IS NULL
     AND last_seen_at < (now() - interval '5 minutes');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_activity_start_session(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_activity_heartbeat(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_activity_end_session(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_activity_close_stale() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.rpc_activity_start_session(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_activity_heartbeat(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_activity_end_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_activity_close_stale() TO authenticated;

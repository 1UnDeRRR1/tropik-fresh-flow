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
  v_ua text := LEFT(COALESCE(p_user_agent, ''), 300);
  v_plat text := LEFT(COALESCE(p_platform, ''), 50);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Idempotency: reuse the most recent active session for this user/UA/platform
  -- if it's still fresh (last seen within 5 minutes and not ended).
  SELECT id INTO v_id
  FROM public.user_activity_sessions
  WHERE user_id = v_uid
    AND ended_at IS NULL
    AND last_seen_at > now() - interval '5 minutes'
    AND COALESCE(user_agent, '') = v_ua
    AND COALESCE(platform, '') = v_plat
  ORDER BY last_seen_at DESC
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.user_activity_sessions
       SET last_seen_at = now(),
           heartbeat_count = heartbeat_count + 1,
           last_path = COALESCE(LEFT(p_last_path, 200), last_path),
           app_version = COALESCE(NULLIF(LEFT(COALESCE(p_app_version, ''), 50), ''), app_version)
     WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.user_activity_sessions (
    user_id, user_agent, platform, app_version, last_path
  ) VALUES (
    v_uid,
    v_ua,
    v_plat,
    LEFT(COALESCE(p_app_version, ''), 50),
    LEFT(COALESCE(p_last_path, ''), 200)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
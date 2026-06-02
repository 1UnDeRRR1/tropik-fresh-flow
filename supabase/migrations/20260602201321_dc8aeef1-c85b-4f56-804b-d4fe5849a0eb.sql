REVOKE EXECUTE ON FUNCTION public.rpc_activity_start_session(text, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rpc_activity_heartbeat(uuid, text)                 FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rpc_activity_end_session(uuid)                     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rpc_activity_close_stale()                         FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.rpc_activity_start_session(text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_activity_heartbeat(uuid, text)                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_activity_end_session(uuid)                     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_activity_close_stale()                         TO authenticated, service_role;
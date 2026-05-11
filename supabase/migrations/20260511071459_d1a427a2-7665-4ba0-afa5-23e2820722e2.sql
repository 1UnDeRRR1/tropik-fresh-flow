REVOKE ALL ON FUNCTION public.can_access_manager_offer(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owns_manager_offer(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_manager_offer(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owns_manager_offer(uuid, uuid) TO authenticated;
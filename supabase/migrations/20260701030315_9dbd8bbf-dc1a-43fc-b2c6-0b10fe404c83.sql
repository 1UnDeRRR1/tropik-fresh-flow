
-- Strip inherited default privileges to match approved spec
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.vehicle_reserves FROM authenticated;
REVOKE ALL ON public.vehicle_reserves FROM anon;
REVOKE ALL ON public.vehicle_capacity_v FROM anon;

-- Re-assert the intended grants (idempotent)
GRANT SELECT ON public.vehicle_reserves TO authenticated;
GRANT ALL    ON public.vehicle_reserves TO service_role;
GRANT SELECT ON public.vehicle_capacity_v TO authenticated;

-- Belt-and-suspenders on the RPCs (defaults may have re-added PUBLIC/anon EXECUTE)
REVOKE ALL ON FUNCTION public.create_vehicle_reserve(uuid, integer, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.release_vehicle_reserve(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_vehicle_reserves(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_vehicle_reserve(uuid, integer, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_vehicle_reserve(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.close_vehicle_reserves(uuid) TO authenticated, service_role;

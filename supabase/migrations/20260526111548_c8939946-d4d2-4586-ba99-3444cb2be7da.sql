
DROP POLICY IF EXISTS "cancelled_archive read auth" ON public.cancelled_shipments_archive;
CREATE POLICY "cancelled_archive read staff"
  ON public.cancelled_shipments_archive
  FOR SELECT
  TO authenticated
  USING (public.is_staff(auth.uid()));

ALTER VIEW public.shipment_items_branch SET (security_invoker = on);
ALTER VIEW public.shipments_branch SET (security_invoker = on);

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prosecdef = true AND n.nspname = 'public'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon, public', r.proname, r.args);
  END LOOP;
END$$;

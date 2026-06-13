DROP POLICY IF EXISTS "shipments staff select" ON public.shipments;

CREATE POLICY "shipments staff select"
  ON public.shipments
  FOR SELECT
  TO authenticated
  USING (is_shipment_owner(id, auth.uid()));
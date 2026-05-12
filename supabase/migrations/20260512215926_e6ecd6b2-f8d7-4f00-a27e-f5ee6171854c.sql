DROP POLICY IF EXISTS "shipments staff select" ON public.shipments;

CREATE POLICY "shipments staff select"
ON public.shipments
FOR SELECT
USING (
  public.is_shipment_owner(id, auth.uid())
);
DROP POLICY IF EXISTS "shipments owner delete" ON public.shipments;

CREATE POLICY "shipments owner delete"
ON public.shipments
FOR DELETE
TO authenticated
USING (public.is_shipment_owner(id, auth.uid()));
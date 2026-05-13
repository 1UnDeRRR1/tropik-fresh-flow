-- Allow staff (import managers, admins) to read shipments that are loaded into
-- the same OPEN vehicle, so co-loaders can see each other's products in the
-- "new shipment / add to existing vehicle" screen and in the shared vehicle UI.
CREATE POLICY "shipments staff read shared open vehicle"
ON public.shipments
FOR SELECT
TO authenticated
USING (
  vehicle_id IS NOT NULL
  AND is_staff(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.vehicles v
    WHERE v.id = shipments.vehicle_id AND v.status = 'open'
  )
);
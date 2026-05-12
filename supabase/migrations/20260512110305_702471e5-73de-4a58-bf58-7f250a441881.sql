
-- Allow any staff/import_manager to see shipments (and their items) attached to OPEN vehicles,
-- so a manager picking another manager's open vehicle can see what is already loaded
-- (shipment code + items). After the vehicle is closed, only owner/coloader/admin keep access.

DROP POLICY IF EXISTS "shipments staff select" ON public.shipments;
CREATE POLICY "shipments staff select"
  ON public.shipments FOR SELECT
  TO authenticated
  USING (
    is_admin(auth.uid())
    OR created_by = auth.uid()
    OR import_manager_id = auth.uid()
    OR (vehicle_id IS NOT NULL AND is_vehicle_coloader(vehicle_id, auth.uid()))
    OR (
      is_staff(auth.uid())
      AND vehicle_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.vehicles v
         WHERE v.id = shipments.vehicle_id
           AND v.status = 'open'
      )
    )
  );

DROP POLICY IF EXISTS "shipment_items owner select" ON public.shipment_items;
CREATE POLICY "shipment_items owner select"
  ON public.shipment_items FOR SELECT
  TO authenticated
  USING (
    is_shipment_owner(shipment_id, auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.shipments s
       WHERE s.id = shipment_items.shipment_id
         AND s.vehicle_id IS NOT NULL
         AND (
           is_vehicle_coloader(s.vehicle_id, auth.uid())
           OR (
             is_staff(auth.uid())
             AND EXISTS (
               SELECT 1 FROM public.vehicles v
                WHERE v.id = s.vehicle_id
                  AND v.status = 'open'
             )
           )
         )
    )
  );


-- Helper: is the user a "co-loader" on a vehicle (owns at least one shipment on it, or is admin)
CREATE OR REPLACE FUNCTION public.is_vehicle_coloader(_vehicle_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _vehicle_id IS NOT NULL AND (
    public.is_admin(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.shipments s
      WHERE s.vehicle_id = _vehicle_id
        AND (s.created_by = _user_id OR s.import_manager_id = _user_id)
    )
  )
$$;

-- Extend shipments SELECT: allow reading shipments that share a vehicle with one I own
DROP POLICY IF EXISTS "shipments staff select" ON public.shipments;
CREATE POLICY "shipments staff select" ON public.shipments
FOR SELECT TO authenticated
USING (
  is_admin(auth.uid())
  OR created_by = auth.uid()
  OR import_manager_id = auth.uid()
  OR (vehicle_id IS NOT NULL AND public.is_vehicle_coloader(vehicle_id, auth.uid()))
);

-- Extend shipment_items SELECT: allow reading items of sibling shipments on shared vehicle
DROP POLICY IF EXISTS "shipment_items owner select" ON public.shipment_items;
CREATE POLICY "shipment_items owner select" ON public.shipment_items
FOR SELECT TO authenticated
USING (
  is_shipment_owner(shipment_id, auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.shipments s
    WHERE s.id = shipment_items.shipment_id
      AND s.vehicle_id IS NOT NULL
      AND public.is_vehicle_coloader(s.vehicle_id, auth.uid())
  )
);

-- Make shipment ownership flow through supplier -> manager -> effective_manager_ids
-- so that during a vacation the replacement manager owns the shipments tied to
-- the vacationing manager's suppliers, and after the vacation ownership reverts
-- automatically to the original manager.

CREATE OR REPLACE FUNCTION public.is_shipment_owner(_shipment_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.is_admin(_user_id) OR EXISTS (
    SELECT 1
    FROM public.shipments s
    LEFT JOIN public.suppliers sup ON sup.id = s.supplier_id
    WHERE s.id = _shipment_id
      AND (
        -- ownership via supplier's import manager (handles vacation replacement)
        (sup.import_manager_id IS NOT NULL
          AND sup.import_manager_id IN (SELECT public.effective_manager_ids(_user_id)))
        -- explicit per-shipment manager assignment (legacy / overrides)
        OR (s.import_manager_id = _user_id)
        -- shipments without a supplier yet: creator owns (drafts)
        OR (s.supplier_id IS NULL AND s.created_by = _user_id)
        -- supplier exists but has no manager assigned: creator owns
        OR (s.supplier_id IS NOT NULL AND sup.import_manager_id IS NULL AND s.created_by = _user_id)
      )
  )
$function$;

-- Update shipments.staff_select to rely on the same logic so that after the
-- vacation ends, shipments tied to the original manager's suppliers disappear
-- from the replacement's list, while shipments with the replacement's own
-- suppliers stay with them.
DROP POLICY IF EXISTS "shipments staff select" ON public.shipments;
CREATE POLICY "shipments staff select"
ON public.shipments
FOR SELECT
TO authenticated
USING (
  public.is_shipment_owner(id, auth.uid())
  OR ((vehicle_id IS NOT NULL) AND public.is_vehicle_coloader(vehicle_id, auth.uid()))
  OR (public.is_staff(auth.uid()) AND vehicle_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.vehicles v
    WHERE v.id = shipments.vehicle_id AND v.status = 'open'::vehicle_status
  ))
);

-- Update update policy as well
DROP POLICY IF EXISTS "shipments owner or admin update" ON public.shipments;
CREATE POLICY "shipments owner or admin update"
ON public.shipments
FOR UPDATE
TO authenticated
USING (public.is_shipment_owner(id, auth.uid()))
WITH CHECK (public.is_shipment_owner(id, auth.uid()));

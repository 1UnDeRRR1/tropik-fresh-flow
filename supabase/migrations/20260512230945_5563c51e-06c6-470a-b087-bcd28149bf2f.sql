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
        (sup.import_manager_id IS NOT NULL
          AND sup.import_manager_id IN (SELECT public.effective_manager_ids(_user_id)))
        OR (s.import_manager_id = _user_id)
        OR (s.created_by = _user_id)
        OR (s.supplier_id IS NOT NULL AND public.can_access_supplier(s.supplier_id, _user_id))
      )
  )
$function$;
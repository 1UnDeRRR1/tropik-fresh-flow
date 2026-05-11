CREATE OR REPLACE VIEW public.shipments_branch
WITH (security_invoker=off) AS
SELECT s.id, s.code, s.country, s.eta, s.arrived_at, s.loading_date,
       s.status, s.created_at, s.updated_at,
       s.import_manager_id,
       im.full_name AS import_manager_name
  FROM public.shipments s
  LEFT JOIN public.import_managers im ON im.id = s.import_manager_id
 WHERE public.is_staff(auth.uid())
    OR EXISTS (SELECT 1 FROM public.distributions d
                WHERE d.shipment_id = s.id
                  AND d.branch_id = public.user_branch_id(auth.uid()))
    OR public.shipment_has_free_pallets(s.id);
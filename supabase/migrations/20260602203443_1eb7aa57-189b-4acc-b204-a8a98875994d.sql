-- Stage 1A: drop & recreate branch-safe views with expanded whitelist.
-- DROP needed because CREATE OR REPLACE cannot reorder/insert view columns.
-- Views remain SECURITY DEFINER (default; no security_invoker). Owner = postgres.
-- Row scope enforced inside view via auth.uid() + user_branch_id().
-- Raw shipments/shipment_items branch read policies are NOT touched in this stage.

DROP VIEW IF EXISTS public.shipments_branch;
DROP VIEW IF EXISTS public.shipment_items_branch;

CREATE VIEW public.shipments_branch AS
SELECT s.id,
       s.code,
       s.country,
       s.eta,
       s.arrived_at,
       s.loading_date,
       s.status,
       s.pipeline_status,
       s.temperature_mode,
       s.created_at,
       s.updated_at,
       s.import_manager_id,
       im.full_name AS import_manager_name,
       s.unloaded_at,
       s.cancelled_at,
       s.archived_at
FROM public.shipments s
LEFT JOIN public.import_managers im ON im.id = s.import_manager_id
WHERE is_staff(auth.uid())
   OR EXISTS (
        SELECT 1 FROM public.distributions d
        WHERE d.shipment_id = s.id
          AND d.branch_id = user_branch_id(auth.uid())
      )
   OR shipment_has_free_pallets(s.id)
   OR EXISTS (
        SELECT 1 FROM public.shipment_items si
        JOIN public.branch_transfer_offers bto ON bto.shipment_item_id = si.id
        WHERE si.shipment_id = s.id
          AND (bto.to_branch_id = user_branch_id(auth.uid())
            OR bto.from_branch_id = user_branch_id(auth.uid()))
      );

REVOKE ALL ON public.shipments_branch FROM anon, PUBLIC;
GRANT SELECT ON public.shipments_branch TO authenticated, service_role;

CREATE VIEW public.shipment_items_branch AS
SELECT si.id,
       si.shipment_id,
       si.product_name,
       si.origin_country,
       si.caliber,
       si.variety,
       si.brand,
       si.class,
       si.linked_offer_id,
       si.sku,
       si.unit,
       si.qty,
       si.weight_kg,
       si.pallet_count,
       si.pallet_weight,
       si.final_cost_indicative,
       si.final_cost_invoice,
       s.import_manager_id,
       im.full_name AS import_manager_name,
       shipment_item_free_pallets(si.id) AS free_pallets,
       si.created_at
FROM public.shipment_items si
JOIN public.shipments s ON s.id = si.shipment_id
LEFT JOIN public.import_managers im ON im.id = s.import_manager_id
WHERE is_staff(auth.uid())
   OR EXISTS (
        SELECT 1 FROM public.distributions d
        WHERE d.shipment_id = si.shipment_id
          AND d.branch_id = user_branch_id(auth.uid())
      )
   OR shipment_item_free_pallets(si.id) > 0
   OR EXISTS (
        SELECT 1 FROM public.branch_transfer_offers bto
        WHERE bto.shipment_item_id = si.id
          AND (bto.to_branch_id = user_branch_id(auth.uid())
            OR bto.from_branch_id = user_branch_id(auth.uid()))
      );

REVOKE ALL ON public.shipment_items_branch FROM anon, PUBLIC;
GRANT SELECT ON public.shipment_items_branch TO authenticated, service_role;
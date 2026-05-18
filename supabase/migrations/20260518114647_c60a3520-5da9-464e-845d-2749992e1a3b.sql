DROP VIEW IF EXISTS public.shipments_branch;
CREATE VIEW public.shipments_branch AS
SELECT
  s.id,
  s.code,
  s.country,
  s.eta,
  s.arrived_at,
  s.loading_date,
  s.status,
  s.created_at,
  s.updated_at,
  s.import_manager_id,
  im.full_name AS import_manager_name,
  s.unloaded_at,
  s.cancelled_at,
  s.archived_at
FROM shipments s
LEFT JOIN import_managers im ON im.id = s.import_manager_id
WHERE
  is_staff(auth.uid())
  OR EXISTS (
    SELECT 1 FROM distributions d
    WHERE d.shipment_id = s.id
      AND d.branch_id = user_branch_id(auth.uid())
  )
  OR shipment_has_free_pallets(s.id)
  OR EXISTS (
    SELECT 1 FROM shipment_items si
    JOIN branch_transfer_offers bto ON bto.shipment_item_id = si.id
    WHERE si.shipment_id = s.id
      AND (
        bto.to_branch_id = user_branch_id(auth.uid())
        OR bto.from_branch_id = user_branch_id(auth.uid())
      )
  );
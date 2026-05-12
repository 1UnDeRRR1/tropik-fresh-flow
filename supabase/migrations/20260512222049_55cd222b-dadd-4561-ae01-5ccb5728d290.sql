
-- Allow target branch of a branch_transfer_offer to read the underlying
-- shipment_item and shipment via the branch-safe views, so they can see
-- product details, ETA, costs of an offer made to them by another branch.

CREATE OR REPLACE VIEW public.shipment_items_branch AS
SELECT
  si.id,
  si.shipment_id,
  si.product_name,
  si.origin_country,
  si.caliber,
  si.variety,
  si.sku,
  si.unit,
  si.qty,
  si.weight_kg,
  si.pallet_count,
  si.pallet_weight,
  si.final_cost_indicative,
  si.final_cost_invoice,
  shipment_item_free_pallets(si.id) AS free_pallets,
  si.created_at
FROM shipment_items si
WHERE
  is_staff(auth.uid())
  OR EXISTS (
    SELECT 1 FROM distributions d
    WHERE d.shipment_id = si.shipment_id
      AND d.branch_id = user_branch_id(auth.uid())
  )
  OR shipment_item_free_pallets(si.id) > 0::numeric
  OR EXISTS (
    SELECT 1 FROM branch_transfer_offers bto
    WHERE bto.shipment_item_id = si.id
      AND (
        bto.to_branch_id = user_branch_id(auth.uid())
        OR bto.from_branch_id = user_branch_id(auth.uid())
      )
  );

CREATE OR REPLACE VIEW public.shipments_branch AS
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
  im.full_name AS import_manager_name
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

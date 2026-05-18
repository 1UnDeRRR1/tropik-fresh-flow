
-- Allow branch users to read shipments they have a distribution for
CREATE POLICY "shipments branch read via distribution"
ON public.shipments
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.distributions d
    WHERE d.shipment_id = shipments.id
      AND d.branch_id = user_branch_id(auth.uid())
  )
);

-- Allow branch users to read shipment_items they have a distribution_item for
CREATE POLICY "shipment_items branch read via distribution"
ON public.shipment_items
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.distribution_items di
    JOIN public.distributions d ON d.id = di.distribution_id
    WHERE di.shipment_item_id = shipment_items.id
      AND d.branch_id = user_branch_id(auth.uid())
  )
);

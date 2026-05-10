DROP POLICY IF EXISTS "shipment_items staff insert" ON public.shipment_items;
CREATE POLICY "shipment_items staff insert"
  ON public.shipment_items FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_staff(auth.uid())
    AND EXISTS (SELECT 1 FROM public.shipments s WHERE s.id = shipment_items.shipment_id)
  );

DROP POLICY IF EXISTS "shipment_items owner or admin update" ON public.shipment_items;
CREATE POLICY "shipment_items staff update"
  ON public.shipment_items FOR UPDATE
  TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "shipment_items owner or admin delete" ON public.shipment_items;
CREATE POLICY "shipment_items staff delete"
  ON public.shipment_items FOR DELETE
  TO authenticated
  USING (public.is_staff(auth.uid()));
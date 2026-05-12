
-- Revert overly permissive staff policies; restore owner-only access to distributions
DROP POLICY IF EXISTS "distributions staff select" ON public.distributions;
DROP POLICY IF EXISTS "distributions staff insert" ON public.distributions;
DROP POLICY IF EXISTS "distributions staff update" ON public.distributions;
DROP POLICY IF EXISTS "distributions staff delete" ON public.distributions;

CREATE POLICY "distributions owner select" ON public.distributions
  FOR SELECT TO authenticated
  USING (is_staff(auth.uid()) AND is_shipment_owner(shipment_id, auth.uid()));

CREATE POLICY "distributions owner insert" ON public.distributions
  FOR INSERT TO authenticated
  WITH CHECK (is_staff(auth.uid()) AND is_shipment_owner(shipment_id, auth.uid()));

CREATE POLICY "distributions owner update" ON public.distributions
  FOR UPDATE TO authenticated
  USING (is_staff(auth.uid()) AND is_shipment_owner(shipment_id, auth.uid()))
  WITH CHECK (is_staff(auth.uid()) AND is_shipment_owner(shipment_id, auth.uid()));

CREATE POLICY "distributions owner delete" ON public.distributions
  FOR DELETE TO authenticated
  USING (is_staff(auth.uid()) AND is_shipment_owner(shipment_id, auth.uid()));

DROP POLICY IF EXISTS "distribution_items staff select" ON public.distribution_items;
DROP POLICY IF EXISTS "distribution_items staff insert" ON public.distribution_items;
DROP POLICY IF EXISTS "distribution_items staff update" ON public.distribution_items;
DROP POLICY IF EXISTS "distribution_items staff delete" ON public.distribution_items;

CREATE POLICY "distribution_items owner select" ON public.distribution_items
  FOR SELECT TO authenticated
  USING (
    is_staff(auth.uid()) AND EXISTS (
      SELECT 1 FROM public.distributions d
      WHERE d.id = distribution_items.distribution_id
        AND is_shipment_owner(d.shipment_id, auth.uid())
    )
  );

CREATE POLICY "distribution_items owner insert" ON public.distribution_items
  FOR INSERT TO authenticated
  WITH CHECK (
    is_staff(auth.uid()) AND EXISTS (
      SELECT 1 FROM public.distributions d
      WHERE d.id = distribution_items.distribution_id
        AND is_shipment_owner(d.shipment_id, auth.uid())
    )
  );

CREATE POLICY "distribution_items owner update" ON public.distribution_items
  FOR UPDATE TO authenticated
  USING (
    is_staff(auth.uid()) AND EXISTS (
      SELECT 1 FROM public.distributions d
      WHERE d.id = distribution_items.distribution_id
        AND is_shipment_owner(d.shipment_id, auth.uid())
    )
  )
  WITH CHECK (
    is_staff(auth.uid()) AND EXISTS (
      SELECT 1 FROM public.distributions d
      WHERE d.id = distribution_items.distribution_id
        AND is_shipment_owner(d.shipment_id, auth.uid())
    )
  );

CREATE POLICY "distribution_items owner delete" ON public.distribution_items
  FOR DELETE TO authenticated
  USING (
    is_staff(auth.uid()) AND EXISTS (
      SELECT 1 FROM public.distributions d
      WHERE d.id = distribution_items.distribution_id
        AND is_shipment_owner(d.shipment_id, auth.uid())
    )
  );

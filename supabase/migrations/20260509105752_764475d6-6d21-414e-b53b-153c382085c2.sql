
CREATE POLICY "shipments branch read all" ON public.shipments
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "shipment_items branch read all" ON public.shipment_items
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "distribution_items auth read" ON public.distribution_items
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "distributions auth read" ON public.distributions
  FOR SELECT TO authenticated USING (true);

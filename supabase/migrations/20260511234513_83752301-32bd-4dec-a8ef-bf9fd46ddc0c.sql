
-- Relax distributions policies: any staff member can manage distributions for any shipment
DROP POLICY IF EXISTS "distributions owner select" ON public.distributions;
DROP POLICY IF EXISTS "distributions owner insert" ON public.distributions;
DROP POLICY IF EXISTS "distributions owner update" ON public.distributions;
DROP POLICY IF EXISTS "distributions owner delete" ON public.distributions;

CREATE POLICY "distributions staff select" ON public.distributions
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "distributions staff insert" ON public.distributions
  FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "distributions staff update" ON public.distributions
  FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "distributions staff delete" ON public.distributions
  FOR DELETE TO authenticated USING (public.is_staff(auth.uid()));

-- Same for distribution_items
DROP POLICY IF EXISTS "distribution_items owner select" ON public.distribution_items;
DROP POLICY IF EXISTS "distribution_items owner insert" ON public.distribution_items;
DROP POLICY IF EXISTS "distribution_items owner update" ON public.distribution_items;
DROP POLICY IF EXISTS "distribution_items owner delete" ON public.distribution_items;

CREATE POLICY "distribution_items staff select" ON public.distribution_items
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "distribution_items staff insert" ON public.distribution_items
  FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "distribution_items staff update" ON public.distribution_items
  FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "distribution_items staff delete" ON public.distribution_items
  FOR DELETE TO authenticated USING (public.is_staff(auth.uid()));

-- 1. distributions: drop broad auth read
DROP POLICY IF EXISTS "distributions auth read" ON public.distributions;

-- 2. distribution_items: drop broad auth read
DROP POLICY IF EXISTS "distribution_items auth read" ON public.distribution_items;

-- 3. loading_plan: restrict SELECT to staff
DROP POLICY IF EXISTS "loading_plan read auth" ON public.loading_plan;
CREATE POLICY "loading_plan read staff"
  ON public.loading_plan FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

-- 4. suppliers: restrict SELECT to staff
DROP POLICY IF EXISTS "suppliers read" ON public.suppliers;
CREATE POLICY "suppliers read staff"
  ON public.suppliers FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

-- 5. import_managers: restrict SELECT to staff
DROP POLICY IF EXISTS "im read auth" ON public.import_managers;
CREATE POLICY "im read staff"
  ON public.import_managers FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
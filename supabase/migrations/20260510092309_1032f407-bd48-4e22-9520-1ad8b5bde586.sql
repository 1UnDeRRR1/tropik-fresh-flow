-- Restore explicit admin-bypass policies so admin/super_admin always have full visibility and control
-- across shipments, items, distributions, branch requests, and vehicles.
-- Multiple PERMISSIVE policies OR together, so manager-scoped policies remain in effect for managers.

-- shipments
DROP POLICY IF EXISTS "shipments admin all" ON public.shipments;
CREATE POLICY "shipments admin all" ON public.shipments
  FOR ALL TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- shipment_items
DROP POLICY IF EXISTS "shipment_items admin all" ON public.shipment_items;
CREATE POLICY "shipment_items admin all" ON public.shipment_items
  FOR ALL TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- distributions
DROP POLICY IF EXISTS "distributions admin all" ON public.distributions;
CREATE POLICY "distributions admin all" ON public.distributions
  FOR ALL TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- distribution_items
DROP POLICY IF EXISTS "distribution_items admin all" ON public.distribution_items;
CREATE POLICY "distribution_items admin all" ON public.distribution_items
  FOR ALL TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- branch_requests
DROP POLICY IF EXISTS "branch_requests admin all" ON public.branch_requests;
CREATE POLICY "branch_requests admin all" ON public.branch_requests
  FOR ALL TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- branch_request_items
DROP POLICY IF EXISTS "branch_request_items admin all" ON public.branch_request_items;
CREATE POLICY "branch_request_items admin all" ON public.branch_request_items
  FOR ALL TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- vehicles (admin can update/close any vehicle)
DROP POLICY IF EXISTS "vehicles admin all" ON public.vehicles;
CREATE POLICY "vehicles admin all" ON public.vehicles
  FOR ALL TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- suppliers (already staff-wide, but make admin explicit and unconditional)
DROP POLICY IF EXISTS "suppliers admin all" ON public.suppliers;
CREATE POLICY "suppliers admin all" ON public.suppliers
  FOR ALL TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));
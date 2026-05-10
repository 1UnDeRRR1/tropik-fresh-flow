
-- Helper: is current user owner of a given shipment (admin counts as owner)
CREATE OR REPLACE FUNCTION public.is_shipment_owner(_shipment_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin(_user_id) OR EXISTS (
    SELECT 1 FROM public.shipments s
    WHERE s.id = _shipment_id
      AND (s.created_by = _user_id OR s.import_manager_id = _user_id)
  )
$$;

-- Helper: can the user close (update) a shared vehicle
CREATE OR REPLACE FUNCTION public.can_close_vehicle(_vehicle_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin(_user_id)
      OR EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = _vehicle_id AND v.created_by = _user_id)
      OR EXISTS (
        SELECT 1 FROM public.shipments s
        WHERE s.vehicle_id = _vehicle_id
          AND (s.created_by = _user_id OR s.import_manager_id = _user_id)
      )
$$;

-- =========================
-- shipments: scope SELECT by ownership
-- =========================
DROP POLICY IF EXISTS "shipments staff select" ON public.shipments;
CREATE POLICY "shipments staff select" ON public.shipments
  FOR SELECT TO authenticated
  USING (
    is_admin(auth.uid())
    OR created_by = auth.uid()
    OR import_manager_id = auth.uid()
  );

-- =========================
-- shipment_items: scope by parent shipment ownership
-- =========================
DROP POLICY IF EXISTS "shipment_items staff select" ON public.shipment_items;
DROP POLICY IF EXISTS "shipment_items staff update" ON public.shipment_items;
DROP POLICY IF EXISTS "shipment_items staff delete" ON public.shipment_items;
DROP POLICY IF EXISTS "shipment_items staff insert" ON public.shipment_items;

CREATE POLICY "shipment_items owner select" ON public.shipment_items
  FOR SELECT TO authenticated
  USING (is_shipment_owner(shipment_id, auth.uid()));

CREATE POLICY "shipment_items owner insert" ON public.shipment_items
  FOR INSERT TO authenticated
  WITH CHECK (is_staff(auth.uid()) AND is_shipment_owner(shipment_id, auth.uid()));

CREATE POLICY "shipment_items owner update" ON public.shipment_items
  FOR UPDATE TO authenticated
  USING (is_shipment_owner(shipment_id, auth.uid()))
  WITH CHECK (is_shipment_owner(shipment_id, auth.uid()));

CREATE POLICY "shipment_items owner delete" ON public.shipment_items
  FOR DELETE TO authenticated
  USING (is_shipment_owner(shipment_id, auth.uid()));

-- =========================
-- distributions: split staff_all into owner-scoped policies (branch policies remain)
-- =========================
DROP POLICY IF EXISTS "distributions staff all" ON public.distributions;

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

-- =========================
-- distribution_items: scope via parent distribution -> shipment owner
-- =========================
DROP POLICY IF EXISTS "distribution_items staff all" ON public.distribution_items;

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

-- =========================
-- branch_requests: managers see only own shipments' requests (+ requests with no shipment)
-- =========================
DROP POLICY IF EXISTS "branch_requests staff all" ON public.branch_requests;

CREATE POLICY "branch_requests owner select" ON public.branch_requests
  FOR SELECT TO authenticated
  USING (
    is_staff(auth.uid()) AND (
      shipment_id IS NULL OR is_shipment_owner(shipment_id, auth.uid())
    )
  );

CREATE POLICY "branch_requests owner insert" ON public.branch_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    is_staff(auth.uid()) AND (
      shipment_id IS NULL OR is_shipment_owner(shipment_id, auth.uid())
    )
  );

CREATE POLICY "branch_requests owner update" ON public.branch_requests
  FOR UPDATE TO authenticated
  USING (
    is_staff(auth.uid()) AND (
      shipment_id IS NULL OR is_shipment_owner(shipment_id, auth.uid())
    )
  )
  WITH CHECK (
    is_staff(auth.uid()) AND (
      shipment_id IS NULL OR is_shipment_owner(shipment_id, auth.uid())
    )
  );

CREATE POLICY "branch_requests owner delete" ON public.branch_requests
  FOR DELETE TO authenticated
  USING (
    is_staff(auth.uid()) AND (
      shipment_id IS NULL OR is_shipment_owner(shipment_id, auth.uid())
    )
  );

-- branch_request_items follow parent
DROP POLICY IF EXISTS "branch_request_items staff all" ON public.branch_request_items;
CREATE POLICY "branch_request_items owner all" ON public.branch_request_items
  FOR ALL TO authenticated
  USING (
    is_staff(auth.uid()) AND EXISTS (
      SELECT 1 FROM public.branch_requests br
      WHERE br.id = branch_request_items.branch_request_id
        AND (br.shipment_id IS NULL OR is_shipment_owner(br.shipment_id, auth.uid()))
    )
  )
  WITH CHECK (
    is_staff(auth.uid()) AND EXISTS (
      SELECT 1 FROM public.branch_requests br
      WHERE br.id = branch_request_items.branch_request_id
        AND (br.shipment_id IS NULL OR is_shipment_owner(br.shipment_id, auth.uid()))
    )
  );

-- =========================
-- vehicles: keep read open to staff (shared loading); restrict UPDATE (close) to admin/owner-in-vehicle
-- =========================
DROP POLICY IF EXISTS "vehicles staff update" ON public.vehicles;
CREATE POLICY "vehicles owner update" ON public.vehicles
  FOR UPDATE TO authenticated
  USING (can_close_vehicle(id, auth.uid()))
  WITH CHECK (can_close_vehicle(id, auth.uid()));

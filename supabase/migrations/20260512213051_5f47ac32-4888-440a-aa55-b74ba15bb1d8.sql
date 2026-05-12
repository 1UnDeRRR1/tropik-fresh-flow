
-- Returns set of import_managers.id that the given user effectively manages right now,
-- including own record + active vacation coverage (full replacement + manual per-supplier).
CREATE OR REPLACE FUNCTION public.effective_manager_ids(_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.import_managers WHERE user_id = _user_id
  UNION
  SELECT v.import_manager_id
  FROM public.manager_vacations v
  JOIN public.import_managers rm ON rm.id = v.replacement_manager_id
  WHERE v.mode = 'full'
    AND rm.user_id = _user_id
    AND CURRENT_DATE BETWEEN v.start_date AND v.end_date
$$;

-- Returns true when the supplier is currently visible to the user via own assignment
-- or via an active vacation coverage (full or manual).
CREATE OR REPLACE FUNCTION public.can_access_supplier(_supplier_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.suppliers s
    WHERE s.id = _supplier_id
      AND s.import_manager_id IN (SELECT public.effective_manager_ids(_user_id))
  )
  OR EXISTS (
    SELECT 1
    FROM public.vacation_supplier_assignments vsa
    JOIN public.manager_vacations v ON v.id = vsa.vacation_id
    JOIN public.import_managers tm ON tm.id = vsa.temp_manager_id
    WHERE vsa.supplier_id = _supplier_id
      AND tm.user_id = _user_id
      AND CURRENT_DATE BETWEEN v.start_date AND v.end_date
  )
$$;

DROP POLICY IF EXISTS "suppliers read scoped" ON public.suppliers;
CREATE POLICY "suppliers read scoped"
ON public.suppliers
FOR SELECT
TO authenticated
USING (
  is_admin(auth.uid())
  OR (
    has_role(auth.uid(), 'import_manager'::app_role)
    AND import_manager_id IS NOT NULL
    AND public.can_access_supplier(id, auth.uid())
  )
);

DROP POLICY IF EXISTS "suppliers update staff scoped" ON public.suppliers;
CREATE POLICY "suppliers update staff scoped"
ON public.suppliers
FOR UPDATE
TO authenticated
USING (
  is_admin(auth.uid())
  OR (
    has_role(auth.uid(), 'import_manager'::app_role)
    AND public.can_access_supplier(id, auth.uid())
  )
)
WITH CHECK (
  is_admin(auth.uid())
  OR (
    has_role(auth.uid(), 'import_manager'::app_role)
    AND public.can_access_supplier(id, auth.uid())
  )
);


ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS code_base text,
  ADD COLUMN IF NOT EXISTS iso3 text;

ALTER TABLE public.import_managers
  ADD COLUMN IF NOT EXISTS user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.current_import_manager_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.import_managers WHERE user_id = auth.uid() LIMIT 1
$$;

-- Tighten supplier read access: managers see only their suppliers.
DROP POLICY IF EXISTS "suppliers read staff" ON public.suppliers;
DROP POLICY IF EXISTS "suppliers write staff" ON public.suppliers;

CREATE POLICY "suppliers read scoped"
  ON public.suppliers
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR (
      public.has_role(auth.uid(), 'import_manager'::app_role)
      AND (
        import_manager_id IS NULL
        OR import_manager_id = public.current_import_manager_id()
      )
    )
  );

CREATE POLICY "suppliers write staff scoped"
  ON public.suppliers
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "suppliers update staff scoped"
  ON public.suppliers
  FOR UPDATE
  TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR (
      public.has_role(auth.uid(), 'import_manager'::app_role)
      AND import_manager_id = public.current_import_manager_id()
    )
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR (
      public.has_role(auth.uid(), 'import_manager'::app_role)
      AND import_manager_id = public.current_import_manager_id()
    )
  );

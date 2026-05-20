DROP POLICY IF EXISTS "suppliers read scoped" ON public.suppliers;

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
        OR import_manager_id IN (SELECT public.effective_manager_ids(auth.uid()))
      )
    )
  );
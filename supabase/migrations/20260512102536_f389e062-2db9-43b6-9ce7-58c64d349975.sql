-- Tighten suppliers RLS: managers only see their own assigned suppliers
DROP POLICY IF EXISTS "suppliers read scoped" ON public.suppliers;
CREATE POLICY "suppliers read scoped" ON public.suppliers
FOR SELECT TO authenticated
USING (
  public.is_admin(auth.uid())
  OR (
    public.has_role(auth.uid(), 'import_manager'::app_role)
    AND import_manager_id IS NOT NULL
    AND import_manager_id = public.current_import_manager_id()
  )
);

-- Remove duplicate empty manager records (no user link and no suppliers)
DELETE FROM public.import_managers im
WHERE im.user_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.suppliers s WHERE s.import_manager_id = im.id)
  AND NOT EXISTS (SELECT 1 FROM public.shipments sh WHERE sh.import_manager_id = im.user_id);

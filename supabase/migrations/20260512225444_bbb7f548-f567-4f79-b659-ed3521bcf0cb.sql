CREATE POLICY "shipments owner delete"
ON public.shipments
FOR DELETE
TO authenticated
USING (import_manager_id = auth.uid());
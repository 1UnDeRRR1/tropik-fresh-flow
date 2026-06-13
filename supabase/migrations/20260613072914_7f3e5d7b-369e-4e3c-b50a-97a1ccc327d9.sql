DROP POLICY IF EXISTS "system_logs auth insert" ON public.system_logs;
CREATE POLICY "system_logs auth insert"
  ON public.system_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_staff(auth.uid()));
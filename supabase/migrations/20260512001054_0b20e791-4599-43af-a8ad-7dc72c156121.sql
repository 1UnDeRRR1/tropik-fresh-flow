
-- Helper
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'super_admin'
  )
$$;

-- profiles.is_active
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- system_logs
CREATE TABLE IF NOT EXISTS public.system_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  level text NOT NULL DEFAULT 'info' CHECK (level IN ('info','warning','critical')),
  message text NOT NULL,
  module text,
  action text,
  user_id uuid,
  user_role text,
  shipment_id uuid,
  offer_id uuid,
  branch_id uuid,
  vehicle_id uuid,
  distribution_id uuid,
  context jsonb
);

CREATE INDEX IF NOT EXISTS system_logs_created_at_idx ON public.system_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS system_logs_level_idx ON public.system_logs (level);

ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "system_logs super read" ON public.system_logs;
CREATE POLICY "system_logs super read" ON public.system_logs
  FOR SELECT TO authenticated
  USING (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "system_logs auth insert" ON public.system_logs;
CREATE POLICY "system_logs auth insert" ON public.system_logs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- Auto-stamp user_id/user_role server-side so clients can't spoof
CREATE OR REPLACE FUNCTION public.stamp_system_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.user_id := auth.uid();
  SELECT string_agg(role::text, ',') INTO NEW.user_role
    FROM public.user_roles WHERE user_id = auth.uid();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_stamp_system_log ON public.system_logs;
CREATE TRIGGER trg_stamp_system_log BEFORE INSERT ON public.system_logs
  FOR EACH ROW EXECUTE FUNCTION public.stamp_system_log();


-- Rename existing tables
ALTER TABLE public.transfers RENAME TO transfer_requests;
ALTER TABLE public.transfer_items RENAME TO transfer_request_items;
ALTER TABLE public.audit_logs RENAME TO trigger_logs;

-- Rename FK column for clarity in items table
ALTER TABLE public.transfer_request_items RENAME COLUMN transfer_id TO transfer_request_id;

-- Branch requests
CREATE TYPE public.branch_request_status AS ENUM ('pending','approved','rejected','fulfilled','cancelled');

CREATE TABLE public.branch_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL,
  shipment_id uuid,
  status public.branch_request_status NOT NULL DEFAULT 'pending',
  requested_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.branch_request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_request_id uuid NOT NULL REFERENCES public.branch_requests(id) ON DELETE CASCADE,
  product_name text NOT NULL,
  qty numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'kg'
);

ALTER TABLE public.branch_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_request_items ENABLE ROW LEVEL SECURITY;

-- branch_requests policies
CREATE POLICY "branch_requests staff all" ON public.branch_requests
  FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "branch_requests branch read" ON public.branch_requests
  FOR SELECT TO authenticated
  USING (branch_id = public.user_branch_id(auth.uid()));

CREATE POLICY "branch_requests branch insert" ON public.branch_requests
  FOR INSERT TO authenticated
  WITH CHECK (branch_id = public.user_branch_id(auth.uid()));

CREATE POLICY "branch_requests branch update own" ON public.branch_requests
  FOR UPDATE TO authenticated
  USING (branch_id = public.user_branch_id(auth.uid()))
  WITH CHECK (branch_id = public.user_branch_id(auth.uid()));

-- items policies
CREATE POLICY "branch_request_items staff all" ON public.branch_request_items
  FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "branch_request_items branch read" ON public.branch_request_items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.branch_requests br
    WHERE br.id = branch_request_items.branch_request_id
      AND br.branch_id = public.user_branch_id(auth.uid())));

CREATE POLICY "branch_request_items branch insert" ON public.branch_request_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.branch_requests br
    WHERE br.id = branch_request_items.branch_request_id
      AND br.branch_id = public.user_branch_id(auth.uid())));

-- updated_at trigger
CREATE TRIGGER branch_requests_touch
BEFORE UPDATE ON public.branch_requests
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

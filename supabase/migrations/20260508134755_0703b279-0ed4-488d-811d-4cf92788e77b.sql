
ALTER TYPE public.shipment_status ADD VALUE IF NOT EXISTS 'loading' BEFORE 'in_transit';
ALTER TYPE public.shipment_status ADD VALUE IF NOT EXISTS 'delayed';

ALTER TABLE public.branch_requests
  ADD COLUMN IF NOT EXISTS request_type text NOT NULL DEFAULT 'more',
  ADD COLUMN IF NOT EXISTS to_branch_id uuid,
  ADD COLUMN IF NOT EXISTS qty numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS decision_notes text,
  ADD COLUMN IF NOT EXISTS approved_qty numeric;

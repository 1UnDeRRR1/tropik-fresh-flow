
ALTER TABLE public.branch_requests
  ADD COLUMN IF NOT EXISTS shipment_item_id uuid,
  ADD COLUMN IF NOT EXISTS pallets numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sale_price numeric,
  ADD COLUMN IF NOT EXISTS sale_currency text DEFAULT 'UAH';

CREATE INDEX IF NOT EXISTS idx_branch_requests_shipment_item ON public.branch_requests(shipment_item_id);

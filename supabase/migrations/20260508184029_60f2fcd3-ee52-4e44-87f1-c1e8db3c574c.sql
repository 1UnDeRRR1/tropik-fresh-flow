
ALTER TABLE public.shipment_items
  ADD COLUMN IF NOT EXISTS variety text,
  ADD COLUMN IF NOT EXISTS origin_country text,
  ADD COLUMN IF NOT EXISTS cost_price_usd numeric DEFAULT 0;


ALTER TABLE public.manager_offers
  ADD COLUMN IF NOT EXISTS price_per_kg numeric,
  ADD COLUMN IF NOT EXISTS price_currency text NOT NULL DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS freight_amount numeric,
  ADD COLUMN IF NOT EXISTS freight_currency text NOT NULL DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS pallet_weight numeric,
  ADD COLUMN IF NOT EXISTS fx_rate_snapshot numeric,
  ADD COLUMN IF NOT EXISTS fx_rate_date date;


ALTER TABLE public.manager_offers
  ADD COLUMN IF NOT EXISTS share_token text;

CREATE UNIQUE INDEX IF NOT EXISTS manager_offers_share_token_key
  ON public.manager_offers (share_token)
  WHERE share_token IS NOT NULL;

ALTER TABLE public.branch_requests
  ADD COLUMN IF NOT EXISTS from_offer_id uuid REFERENCES public.manager_offers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS branch_requests_from_offer_id_idx
  ON public.branch_requests (from_offer_id)
  WHERE from_offer_id IS NOT NULL;

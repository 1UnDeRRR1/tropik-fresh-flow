ALTER TABLE public.manager_offers
  ADD COLUMN pallet_net_kg numeric NULL,
  ADD COLUMN pallet_gross_kg numeric NULL;

ALTER TABLE public.manager_offers
  ADD CONSTRAINT manager_offers_net_gross_pair_chk
  CHECK (
    (pallet_net_kg IS NULL AND pallet_gross_kg IS NULL)
    OR (
      pallet_net_kg IS NOT NULL
      AND pallet_gross_kg IS NOT NULL
      AND pallet_net_kg > 0
      AND pallet_gross_kg > pallet_net_kg
    )
  );

ALTER TABLE public.shipment_items
  ADD COLUMN package_used text,
  ADD COLUMN net_weight_kg numeric,
  ADD COLUMN gross_weight_kg numeric,
  ADD COLUMN resolver_net_per_pallet_kg numeric,
  ADD COLUMN resolver_gross_per_pallet_kg numeric,
  ADD COLUMN net_auto boolean NOT NULL DEFAULT false,
  ADD COLUMN gross_auto boolean NOT NULL DEFAULT false;

ALTER TABLE public.shipment_items DISABLE TRIGGER USER;

UPDATE public.shipment_items
SET
  net_weight_kg = CASE
    WHEN pallet_count IS NOT NULL AND pallet_count > 0
     AND pallet_weight IS NOT NULL AND pallet_weight > 0
    THEN pallet_count * pallet_weight
    ELSE NULL
  END,
  gross_weight_kg = CASE
    WHEN pallet_count IS NOT NULL AND pallet_count > 0
     AND pallet_weight IS NOT NULL AND pallet_weight > 0
    THEN pallet_count * pallet_weight
    ELSE NULL
  END,
  resolver_net_per_pallet_kg = CASE
    WHEN pallet_weight IS NOT NULL AND pallet_weight > 0
    THEN pallet_weight
    ELSE NULL
  END,
  resolver_gross_per_pallet_kg = CASE
    WHEN pallet_weight IS NOT NULL AND pallet_weight > 0
    THEN pallet_weight
    ELSE NULL
  END,
  package_used = NULL,
  net_auto = false,
  gross_auto = false;

ALTER TABLE public.shipment_items ENABLE TRIGGER USER;

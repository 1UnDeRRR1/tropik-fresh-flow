ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS final_freight_payment text;
ALTER TABLE public.shipments ADD CONSTRAINT shipments_final_freight_payment_check
  CHECK (final_freight_payment IS NULL OR final_freight_payment IN ('cash','bank'));
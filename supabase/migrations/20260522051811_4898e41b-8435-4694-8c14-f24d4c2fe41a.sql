
ALTER TABLE public.manager_offers
  ADD CONSTRAINT mo_customs_override_confirmed_requires_duty
    CHECK (
      customs_override_confirmed_at IS NULL
      OR (customs_override_duty_usd IS NOT NULL AND customs_override_duty_usd >  0)
    );

ALTER TABLE public.shipment_items
  ADD CONSTRAINT si_customs_override_confirmed_requires_duty
    CHECK (
      customs_override_confirmed_at IS NULL
      OR (customs_override_duty_usd IS NOT NULL AND customs_override_duty_usd > 0)
    );

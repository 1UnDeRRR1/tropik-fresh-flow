-- Auto-close any open vehicles that already meet the close conditions:
-- >= 26 pallets loaded OR >= 21000 kg loaded (regardless of the other metric).
UPDATE public.vehicles
SET status = 'closed',
    closed_at = COALESCE(closed_at, now())
WHERE status = 'open'
  AND (COALESCE(total_pallets, 0) >= 26 OR COALESCE(total_weight_kg, 0) >= 21000);
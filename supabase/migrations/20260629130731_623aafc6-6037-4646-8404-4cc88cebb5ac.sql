
BEGIN;

CREATE TEMP TABLE target_vehicles ON COMMIT DROP AS
SELECT id FROM public.vehicles
WHERE status = 'open' AND eta <= DATE '2026-06-29';

CREATE TEMP TABLE target_shipments ON COMMIT DROP AS
SELECT id FROM public.shipments
WHERE vehicle_id IN (SELECT id FROM target_vehicles);

CREATE TEMP TABLE target_shipment_items ON COMMIT DROP AS
SELECT id FROM public.shipment_items
WHERE shipment_id IN (SELECT id FROM target_shipments);

CREATE TEMP TABLE target_distributions ON COMMIT DROP AS
SELECT id FROM public.distributions
WHERE shipment_id IN (SELECT id FROM target_shipments);

-- Pre-counts
DO $$
DECLARE v INT; s INT; si INT; d INT; di INT; moap INT; psl INT; op_before INT;
BEGIN
  SELECT count(*) INTO v FROM target_vehicles;
  SELECT count(*) INTO s FROM target_shipments;
  SELECT count(*) INTO si FROM target_shipment_items;
  SELECT count(*) INTO d FROM target_distributions;
  SELECT count(*) INTO di FROM public.distribution_items WHERE distribution_id IN (SELECT id FROM target_distributions);
  SELECT count(*) INTO moap FROM public.manager_offer_allocation_parts WHERE shipment_id IN (SELECT id FROM target_shipments);
  SELECT count(*) INTO psl FROM public.position_shipment_links WHERE shipment_id IN (SELECT id FROM target_shipments);
  SELECT count(*) INTO op_before FROM public.operational_positions;
  RAISE NOTICE 'PRE: vehicles=%, shipments=%, shipment_items=%, distributions=%, distribution_items=%, moap=%, psl=%, op_total=%', v,s,si,d,di,moap,psl,op_before;
END $$;

-- Disable blocking triggers (only those that block DELETE of target set)
ALTER TABLE public.shipments         DISABLE TRIGGER trg_shipments_block_locked_edits;
ALTER TABLE public.shipment_items    DISABLE TRIGGER trg_shipment_items_lock;
ALTER TABLE public.distributions     DISABLE TRIGGER trg_distributions_lock;
ALTER TABLE public.distribution_items DISABLE TRIGGER trg_distribution_items_lock;

-- Delete in safe dependency order
DELETE FROM public.distribution_items WHERE distribution_id IN (SELECT id FROM target_distributions);
DELETE FROM public.distributions       WHERE id IN (SELECT id FROM target_distributions);
DELETE FROM public.manager_offer_allocation_parts WHERE shipment_id IN (SELECT id FROM target_shipments);
DELETE FROM public.position_shipment_links        WHERE shipment_id IN (SELECT id FROM target_shipments);
DELETE FROM public.shipment_items      WHERE shipment_id IN (SELECT id FROM target_shipments);
DELETE FROM public.shipments           WHERE id IN (SELECT id FROM target_shipments);
DELETE FROM public.vehicles            WHERE id IN (SELECT id FROM target_vehicles);

-- Re-enable triggers
ALTER TABLE public.shipments         ENABLE TRIGGER trg_shipments_block_locked_edits;
ALTER TABLE public.shipment_items    ENABLE TRIGGER trg_shipment_items_lock;
ALTER TABLE public.distributions     ENABLE TRIGGER trg_distributions_lock;
ALTER TABLE public.distribution_items ENABLE TRIGGER trg_distribution_items_lock;

-- Post-check
DO $$
DECLARE remaining_v INT; remaining_s INT; op_after INT;
BEGIN
  SELECT count(*) INTO remaining_v FROM public.vehicles WHERE status='open' AND eta <= DATE '2026-06-29';
  SELECT count(*) INTO remaining_s FROM public.shipments WHERE id IN (SELECT id FROM target_shipments);
  SELECT count(*) INTO op_after FROM public.operational_positions;
  IF remaining_v <> 0 THEN RAISE EXCEPTION 'remaining open vehicles ETA<=2026-06-29 = %', remaining_v; END IF;
  IF remaining_s <> 0 THEN RAISE EXCEPTION 'remaining target shipments = %', remaining_s; END IF;
  RAISE NOTICE 'POST: remaining_vehicles=%, remaining_shipments=%, operational_positions_total=%', remaining_v, remaining_s, op_after;
END $$;

COMMIT;

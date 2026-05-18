
-- Map pipeline_status to logistics_status to keep both views consistent.
CREATE OR REPLACE FUNCTION public.shipments_sync_logistics_from_pipeline()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  target public.logistics_status;
BEGIN
  IF NEW.pipeline_status IS NULL THEN
    RETURN NEW;
  END IF;

  target := CASE NEW.pipeline_status
    WHEN 'awaiting_loading' THEN 'ready_for_loading'::public.logistics_status
    WHEN 'loading'          THEN 'loading'::public.logistics_status
    WHEN 'in_transit'       THEN 'in_transit'::public.logistics_status
    WHEN 'at_customs'       THEN 'at_customs'::public.logistics_status
    WHEN 'left_customs'     THEN 'in_transit'::public.logistics_status
    WHEN 'at_warehouse'     THEN 'arrived'::public.logistics_status
    WHEN 'unloaded'         THEN 'arrived'::public.logistics_status
    ELSE NULL
  END;

  IF target IS NOT NULL AND NEW.logistics_status IS DISTINCT FROM target THEN
    -- Only move forward; never downgrade (e.g. keep 'delayed' or manual states)
    IF NEW.logistics_status IS NULL
       OR array_position(ARRAY['pending_planning','planning','vehicle_assigned','ready_for_loading','loading','in_transit','at_customs','arrived']::text[], target::text)
        > array_position(ARRAY['pending_planning','planning','vehicle_assigned','ready_for_loading','loading','in_transit','at_customs','arrived']::text[], NEW.logistics_status::text)
       OR NEW.logistics_status = 'delayed' IS FALSE
    THEN
      -- never overwrite 'delayed' automatically
      IF NEW.logistics_status IS DISTINCT FROM 'delayed'::public.logistics_status THEN
        NEW.logistics_status := target;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shipments_sync_logistics_from_pipeline ON public.shipments;
CREATE TRIGGER trg_shipments_sync_logistics_from_pipeline
BEFORE INSERT OR UPDATE OF pipeline_status ON public.shipments
FOR EACH ROW EXECUTE FUNCTION public.shipments_sync_logistics_from_pipeline();

-- Backfill existing rows where the two statuses disagree.
UPDATE public.shipments
SET logistics_status = CASE pipeline_status
    WHEN 'awaiting_loading' THEN 'ready_for_loading'::public.logistics_status
    WHEN 'loading'          THEN 'loading'::public.logistics_status
    WHEN 'in_transit'       THEN 'in_transit'::public.logistics_status
    WHEN 'at_customs'       THEN 'at_customs'::public.logistics_status
    WHEN 'left_customs'     THEN 'in_transit'::public.logistics_status
    WHEN 'at_warehouse'     THEN 'arrived'::public.logistics_status
    WHEN 'unloaded'         THEN 'arrived'::public.logistics_status
    ELSE logistics_status
  END
WHERE pipeline_status IN ('awaiting_loading','loading','in_transit','at_customs','left_customs','at_warehouse','unloaded')
  AND logistics_status IS DISTINCT FROM 'delayed'::public.logistics_status
  AND logistics_status IS DISTINCT FROM CASE pipeline_status
    WHEN 'awaiting_loading' THEN 'ready_for_loading'::public.logistics_status
    WHEN 'loading'          THEN 'loading'::public.logistics_status
    WHEN 'in_transit'       THEN 'in_transit'::public.logistics_status
    WHEN 'at_customs'       THEN 'at_customs'::public.logistics_status
    WHEN 'left_customs'     THEN 'in_transit'::public.logistics_status
    WHEN 'at_warehouse'     THEN 'arrived'::public.logistics_status
    WHEN 'unloaded'         THEN 'arrived'::public.logistics_status
  END;


-- 1. Extend pipeline_status enum
ALTER TYPE public.pipeline_status ADD VALUE IF NOT EXISTS 'awaiting_confirmation';
ALTER TYPE public.pipeline_status ADD VALUE IF NOT EXISTS 'rejected';
ALTER TYPE public.pipeline_status ADD VALUE IF NOT EXISTS 'confirmed';
ALTER TYPE public.pipeline_status ADD VALUE IF NOT EXISTS 'unloaded';

-- 2. Manual override flag on shipments
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS manual_status_override boolean NOT NULL DEFAULT false;

-- 3. Relax shipments_logistics_autobump: 3 critical fields are enough
CREATE OR REPLACE FUNCTION public.shipments_logistics_autobump()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- pending_planning -> vehicle_assigned when a plate is first entered
  IF NEW.logistics_status = 'pending_planning'
     AND (NEW.tractor_plate IS NOT NULL OR NEW.vehicle_plate IS NOT NULL)
     AND (OLD.tractor_plate IS NULL AND OLD.vehicle_plate IS NULL) THEN
    NEW.logistics_status := 'vehicle_assigned';
  END IF;

  -- vehicle_assigned -> ready_for_loading when the 3 critical fields are filled:
  -- vehicle plate, loading reference, loading address
  IF NEW.logistics_status IN ('pending_planning','vehicle_assigned')
     AND COALESCE(NULLIF(NEW.tractor_plate,''), NULLIF(NEW.vehicle_plate,'')) IS NOT NULL
     AND NULLIF(NEW.loading_address,'')   IS NOT NULL
     AND NULLIF(NEW.loading_reference,'') IS NOT NULL THEN
    NEW.logistics_status := 'ready_for_loading';
    -- Bump pipeline status when transitioning into ready_for_loading
    IF NEW.pipeline_status IN ('ordered','confirmed') AND NOT NEW.manual_status_override THEN
      NEW.pipeline_status := 'awaiting_loading';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 4. When a shipment_item is linked to a manager_offer, lift shipment to 'confirmed'
CREATE OR REPLACE FUNCTION public.shipment_items_confirm_pipeline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.linked_offer_id IS NOT NULL THEN
    UPDATE public.shipments s
       SET pipeline_status = 'confirmed'
     WHERE s.id = NEW.shipment_id
       AND s.pipeline_status = 'ordered'
       AND NOT s.manual_status_override;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_shipment_items_confirm_pipeline ON public.shipment_items;
CREATE TRIGGER trg_shipment_items_confirm_pipeline
  AFTER INSERT OR UPDATE OF linked_offer_id, shipment_id ON public.shipment_items
  FOR EACH ROW EXECUTE FUNCTION public.shipment_items_confirm_pipeline();

-- 5. Hourly tick that advances pipeline based on real-time dates
CREATE OR REPLACE FUNCTION public.tick_shipment_pipeline()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count int;
BEGIN
  -- awaiting_loading -> loading on ETD day
  UPDATE public.shipments
     SET pipeline_status = 'loading'
   WHERE pipeline_status = 'awaiting_loading'
     AND NOT manual_status_override
     AND loading_date = CURRENT_DATE
     AND status NOT IN ('cancelled');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count > 0 THEN
    INSERT INTO public.system_logs(module, action, message, level)
    VALUES ('pipeline','auto_advance', format('loading: %s shipments', v_count), 'info');
  END IF;

  -- awaiting_loading/loading -> in_transit on the day after loading_date
  UPDATE public.shipments
     SET pipeline_status = 'in_transit'
   WHERE pipeline_status IN ('awaiting_loading','loading')
     AND NOT manual_status_override
     AND loading_date IS NOT NULL
     AND loading_date < CURRENT_DATE
     AND status NOT IN ('cancelled');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count > 0 THEN
    INSERT INTO public.system_logs(module, action, message, level)
    VALUES ('pipeline','auto_advance', format('in_transit: %s shipments', v_count), 'info');
  END IF;

  -- at_warehouse -> unloaded the day after at_warehouse_at
  UPDATE public.shipments
     SET pipeline_status = 'unloaded',
         unloaded_at = COALESCE(unloaded_at, now())
   WHERE pipeline_status = 'at_warehouse'
     AND NOT manual_status_override
     AND at_warehouse_at IS NOT NULL
     AND at_warehouse_at::date < CURRENT_DATE
     AND status NOT IN ('cancelled');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count > 0 THEN
    INSERT INTO public.system_logs(module, action, message, level)
    VALUES ('pipeline','auto_advance', format('unloaded: %s shipments', v_count), 'info');
  END IF;

  -- archive 24h after unloaded
  UPDATE public.shipments
     SET archived_at = now()
   WHERE pipeline_status = 'unloaded'
     AND archived_at IS NULL
     AND unloaded_at IS NOT NULL
     AND unloaded_at < (now() - interval '24 hours');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count > 0 THEN
    INSERT INTO public.system_logs(module, action, message, level)
    VALUES ('pipeline','auto_archive', format('archived: %s shipments', v_count), 'info');
  END IF;
END;
$function$;

-- 6. Schedule hourly cron job
DO $$
BEGIN
  PERFORM cron.unschedule('tick_shipment_pipeline');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'tick_shipment_pipeline',
  '0 * * * *',
  $$SELECT public.tick_shipment_pipeline();$$
);

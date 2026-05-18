
DO $$ BEGIN
  CREATE TYPE public.pipeline_status AS ENUM (
    'proposed','processing','ordered','awaiting_loading','loading',
    'in_transit','at_customs','left_customs','at_warehouse'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.manager_offers
  ADD COLUMN IF NOT EXISTS pipeline_status public.pipeline_status NOT NULL DEFAULT 'proposed';

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS pipeline_status public.pipeline_status NOT NULL DEFAULT 'ordered',
  ADD COLUMN IF NOT EXISTS at_customs_at timestamptz,
  ADD COLUMN IF NOT EXISTS left_customs_at timestamptz,
  ADD COLUMN IF NOT EXISTS at_warehouse_at timestamptz;

CREATE OR REPLACE FUNCTION public.manager_offers_auto_pipeline()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'active' THEN NEW.pipeline_status := 'proposed'; END IF;
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status = 'active' THEN
        NEW.pipeline_status := 'proposed';
      ELSIF NEW.status = 'closed' THEN
        NEW.pipeline_status := 'processing';
      ELSIF NEW.status = 'linked' AND NEW.linked_shipment_id IS NOT NULL THEN
        NEW.pipeline_status := 'ordered';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_manager_offers_auto_pipeline ON public.manager_offers;
CREATE TRIGGER trg_manager_offers_auto_pipeline
  BEFORE INSERT OR UPDATE ON public.manager_offers
  FOR EACH ROW EXECUTE FUNCTION public.manager_offers_auto_pipeline();

CREATE OR REPLACE FUNCTION public.shipments_auto_pipeline()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  has_vehicle boolean;
  has_loading_info boolean;
BEGIN
  has_vehicle := COALESCE(btrim(COALESCE(NEW.vehicle_plate, NEW.tractor_plate, '')), '') <> ''
                 AND COALESCE(btrim(COALESCE(NEW.driver_name, '')), '') <> '';
  has_loading_info := COALESCE(btrim(COALESCE(NEW.loading_address, '')), '') <> ''
                      AND COALESCE(btrim(COALESCE(NEW.loading_reference, '')), '') <> '';
  IF NEW.pipeline_status IN ('ordered','awaiting_loading') THEN
    IF has_vehicle AND has_loading_info THEN
      NEW.pipeline_status := 'awaiting_loading';
    ELSE
      NEW.pipeline_status := 'ordered';
    END IF;
  END IF;

  IF NEW.pipeline_status = 'at_customs' AND (TG_OP = 'INSERT' OR OLD.pipeline_status IS DISTINCT FROM NEW.pipeline_status) THEN
    NEW.at_customs_at := COALESCE(NEW.at_customs_at, now());
  END IF;
  IF NEW.pipeline_status = 'left_customs' AND (TG_OP = 'INSERT' OR OLD.pipeline_status IS DISTINCT FROM NEW.pipeline_status) THEN
    NEW.left_customs_at := COALESCE(NEW.left_customs_at, now());
  END IF;
  IF NEW.pipeline_status = 'at_warehouse' AND (TG_OP = 'INSERT' OR OLD.pipeline_status IS DISTINCT FROM NEW.pipeline_status) THEN
    NEW.at_warehouse_at := COALESCE(NEW.at_warehouse_at, now());
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_shipments_auto_pipeline ON public.shipments;
CREATE TRIGGER trg_shipments_auto_pipeline
  BEFORE INSERT OR UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.shipments_auto_pipeline();

DROP POLICY IF EXISTS shipments_broker_read ON public.shipments;
CREATE POLICY shipments_broker_read ON public.shipments
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'broker'::app_role));

DROP POLICY IF EXISTS shipments_broker_update ON public.shipments;
CREATE POLICY shipments_broker_update ON public.shipments
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'broker'::app_role))
  WITH CHECK (has_role(auth.uid(), 'broker'::app_role));

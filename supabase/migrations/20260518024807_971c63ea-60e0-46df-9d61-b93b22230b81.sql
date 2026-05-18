
CREATE TYPE public.logistics_status AS ENUM (
  'pending_planning','planning','vehicle_assigned','ready_for_loading',
  'loading','in_transit','at_customs','delayed','arrived'
);

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS logistics_status public.logistics_status NOT NULL DEFAULT 'pending_planning',
  ADD COLUMN IF NOT EXISTS loading_address text,
  ADD COLUMN IF NOT EXISTS loading_reference text,
  ADD COLUMN IF NOT EXISTS driver_name text,
  ADD COLUMN IF NOT EXISTS driver_phone text,
  ADD COLUMN IF NOT EXISTS vehicle_plate text,
  ADD COLUMN IF NOT EXISTS tractor_plate text,
  ADD COLUMN IF NOT EXISTS trailer_plate text,
  ADD COLUMN IF NOT EXISTS logistics_comment text,
  ADD COLUMN IF NOT EXISTS loading_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS loading_ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS final_freight_amount numeric,
  ADD COLUMN IF NOT EXISTS final_freight_currency text,
  ADD COLUMN IF NOT EXISTS temperature_mode text;

CREATE OR REPLACE FUNCTION public.shipments_logistics_autobump()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.logistics_status = 'pending_planning'
     AND (NEW.tractor_plate IS NOT NULL OR NEW.vehicle_plate IS NOT NULL)
     AND (OLD.tractor_plate IS NULL AND OLD.vehicle_plate IS NULL) THEN
    NEW.logistics_status := 'vehicle_assigned';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shipments_logistics_autobump ON public.shipments;
CREATE TRIGGER trg_shipments_logistics_autobump
  BEFORE UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.shipments_logistics_autobump();

CREATE POLICY "shipments logistics read"
  ON public.shipments FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'logistics'));

CREATE POLICY "shipments logistics update"
  ON public.shipments FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'logistics'))
  WITH CHECK (public.has_role(auth.uid(), 'logistics'));

CREATE POLICY "shipment_items logistics read"
  ON public.shipment_items FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'logistics'));

CREATE POLICY "suppliers logistics read"
  ON public.suppliers FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'logistics'));

CREATE POLICY "import_managers logistics read"
  ON public.import_managers FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'logistics'));


-- 1) Enum and table
DO $$ BEGIN
  CREATE TYPE public.vehicle_status AS ENUM ('open','closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  country text NOT NULL,
  country_code text NOT NULL,
  sequence_no int NOT NULL,
  loading_date date,
  eta date,
  logistics_days int,
  status public.vehicle_status NOT NULL DEFAULT 'open',
  total_pallets numeric NOT NULL DEFAULT 0,
  total_weight_kg numeric NOT NULL DEFAULT 0,
  closed_at timestamptz,
  closed_by uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country_code, sequence_no)
);

CREATE INDEX IF NOT EXISTS idx_vehicles_status_country ON public.vehicles(status, country);

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vehicles staff read" ON public.vehicles;
CREATE POLICY "vehicles staff read" ON public.vehicles
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "vehicles staff write" ON public.vehicles;
CREATE POLICY "vehicles staff write" ON public.vehicles
  FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "vehicles staff update" ON public.vehicles;
CREATE POLICY "vehicles staff update" ON public.vehicles
  FOR UPDATE TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "vehicles admin delete" ON public.vehicles;
CREATE POLICY "vehicles admin delete" ON public.vehicles
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

CREATE TRIGGER trg_vehicles_updated_at
  BEFORE UPDATE ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2) Add vehicle_id to shipments
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_shipments_vehicle_id ON public.shipments(vehicle_id);

-- 3) next_vehicle_sequence
CREATE OR REPLACE FUNCTION public.next_vehicle_sequence(p_country_code text)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(MAX(sequence_no), 0) + 1 FROM public.vehicles WHERE country_code = p_country_code;
$$;

-- 4) Recompute vehicle totals + autoclose
CREATE OR REPLACE FUNCTION public.recompute_vehicle_totals_for(_vehicle_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pallets numeric := 0;
  v_weight numeric := 0;
BEGIN
  IF _vehicle_id IS NULL THEN RETURN; END IF;
  SELECT
    COALESCE(SUM(COALESCE(si.pallet_count,0)), 0),
    COALESCE(SUM(COALESCE(si.pallet_count,0) * COALESCE(si.pallet_weight,0)), 0)
  INTO v_pallets, v_weight
  FROM public.shipment_items si
  JOIN public.shipments s ON s.id = si.shipment_id
  WHERE s.vehicle_id = _vehicle_id;

  UPDATE public.vehicles
    SET total_pallets = v_pallets,
        total_weight_kg = v_weight,
        status = CASE
          WHEN status = 'closed' THEN 'closed'::public.vehicle_status
          WHEN v_pallets >= 26 OR v_weight >= 21500 OR (26 - v_pallets) <= 1 THEN 'closed'::public.vehicle_status
          ELSE 'open'::public.vehicle_status
        END,
        closed_at = CASE
          WHEN status = 'closed' THEN closed_at
          WHEN v_pallets >= 26 OR v_weight >= 21500 OR (26 - v_pallets) <= 1 THEN COALESCE(closed_at, now())
          ELSE NULL
        END
    WHERE id = _vehicle_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_si_recompute_vehicle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    SELECT vehicle_id INTO v_id FROM public.shipments WHERE id = OLD.shipment_id;
    PERFORM public.recompute_vehicle_totals_for(v_id);
    RETURN OLD;
  ELSE
    SELECT vehicle_id INTO v_id FROM public.shipments WHERE id = NEW.shipment_id;
    PERFORM public.recompute_vehicle_totals_for(v_id);
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_shipment_items_vehicle_totals ON public.shipment_items;
CREATE TRIGGER trg_shipment_items_vehicle_totals
  AFTER INSERT OR UPDATE OR DELETE ON public.shipment_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_si_recompute_vehicle();

-- Also recompute when shipments.vehicle_id changes
CREATE OR REPLACE FUNCTION public.trg_sh_recompute_vehicle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    PERFORM public.recompute_vehicle_totals_for(OLD.vehicle_id);
    RETURN OLD;
  END IF;
  PERFORM public.recompute_vehicle_totals_for(NEW.vehicle_id);
  IF (TG_OP = 'UPDATE' AND NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id) THEN
    PERFORM public.recompute_vehicle_totals_for(OLD.vehicle_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shipments_vehicle_totals ON public.shipments;
CREATE TRIGGER trg_shipments_vehicle_totals
  AFTER INSERT OR UPDATE OF vehicle_id OR DELETE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.trg_sh_recompute_vehicle();

-- 5) Tighten shipments RLS: any staff can INSERT, but only owner or admin can UPDATE/DELETE
DROP POLICY IF EXISTS "shipments staff all" ON public.shipments;

CREATE POLICY "shipments staff select" ON public.shipments
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

CREATE POLICY "shipments staff insert" ON public.shipments
  FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "shipments owner or admin update" ON public.shipments
  FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()) OR created_by = auth.uid())
  WITH CHECK (public.is_admin(auth.uid()) OR created_by = auth.uid());

CREATE POLICY "shipments admin delete" ON public.shipments
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

-- shipment_items: tighten same way (owner of parent shipment, or admin)
DROP POLICY IF EXISTS "shipment_items staff all" ON public.shipment_items;

CREATE POLICY "shipment_items staff select" ON public.shipment_items
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

CREATE POLICY "shipment_items staff insert" ON public.shipment_items
  FOR INSERT TO authenticated WITH CHECK (
    public.is_staff(auth.uid()) AND EXISTS (
      SELECT 1 FROM public.shipments s WHERE s.id = shipment_id
        AND (public.is_admin(auth.uid()) OR s.created_by = auth.uid())
    )
  );

CREATE POLICY "shipment_items owner or admin update" ON public.shipment_items
  FOR UPDATE TO authenticated
  USING (
    public.is_admin(auth.uid()) OR EXISTS (
      SELECT 1 FROM public.shipments s WHERE s.id = shipment_id AND s.created_by = auth.uid()
    )
  )
  WITH CHECK (
    public.is_admin(auth.uid()) OR EXISTS (
      SELECT 1 FROM public.shipments s WHERE s.id = shipment_id AND s.created_by = auth.uid()
    )
  );

CREATE POLICY "shipment_items owner or admin delete" ON public.shipment_items
  FOR DELETE TO authenticated USING (
    public.is_admin(auth.uid()) OR EXISTS (
      SELECT 1 FROM public.shipments s WHERE s.id = shipment_id AND s.created_by = auth.uid()
    )
  );

-- Branch read policy on shipment_items already present (via distributions); keep as-is.

-- 6) Backfill vehicles for existing shipments
DO $$
DECLARE
  r RECORD;
  v_country text;
  v_cc text;
  v_seq int;
  v_code text;
  v_vid uuid;
  cc_map jsonb := '{
    "Греція":"GR","Італія":"IT","Іспанія":"ES","Нідерланди":"NL","Бельгія":"BE",
    "Польща":"PL","Молдова":"MD","Албанія":"AL","Македонія":"MK"
  }'::jsonb;
BEGIN
  FOR r IN
    SELECT id, country, loading_date, eta, logistics_days, created_by, created_at, code
    FROM public.shipments
    WHERE vehicle_id IS NULL
    ORDER BY created_at
  LOOP
    v_country := COALESCE(r.country, 'Невідомо');
    v_cc := COALESCE(cc_map ->> v_country, UPPER(LEFT(regexp_replace(v_country, '[^A-Za-z]', '', 'g'), 2)));
    IF v_cc IS NULL OR v_cc = '' THEN v_cc := 'XX'; END IF;
    v_seq := COALESCE((SELECT MAX(sequence_no) FROM public.vehicles WHERE country_code = v_cc), 0) + 1;
    v_code := v_cc || LPAD(v_seq::text, 2, '0');

    INSERT INTO public.vehicles (code, country, country_code, sequence_no, loading_date, eta, logistics_days, status, created_by, created_at)
    VALUES (v_code, v_country, v_cc, v_seq, r.loading_date, r.eta, r.logistics_days, 'open', r.created_by, r.created_at)
    RETURNING id INTO v_vid;

    UPDATE public.shipments SET vehicle_id = v_vid WHERE id = r.id;
  END LOOP;
END $$;

-- After backfill, recompute totals for all vehicles
DO $$
DECLARE v RECORD;
BEGIN
  FOR v IN SELECT id FROM public.vehicles LOOP
    PERFORM public.recompute_vehicle_totals_for(v.id);
  END LOOP;
END $$;

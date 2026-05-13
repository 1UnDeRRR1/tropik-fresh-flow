CREATE OR REPLACE FUNCTION public.recompute_vehicle_totals_for(_vehicle_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pallets numeric := 0;
  v_weight numeric := 0;
BEGIN
  IF _vehicle_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    COALESCE(SUM(COALESCE(si.pallet_count, 0)), 0),
    COALESCE(SUM(COALESCE(si.pallet_count, 0) * COALESCE(si.pallet_weight, 0)), 0)
  INTO v_pallets, v_weight
  FROM public.shipment_items si
  JOIN public.shipments s ON s.id = si.shipment_id
  WHERE s.vehicle_id = _vehicle_id;

  UPDATE public.vehicles v
  SET total_pallets = v_pallets,
      total_weight_kg = v_weight,
      status = CASE
        WHEN v.status = 'closed'::public.vehicle_status AND (v.closed_by IS NOT NULL OR v.closed_at IS NOT NULL)
          THEN 'closed'::public.vehicle_status
        WHEN v_pallets = 26 OR v_weight = 21500
          THEN 'closed'::public.vehicle_status
        ELSE 'open'::public.vehicle_status
      END,
      closed_at = CASE
        WHEN v.status = 'closed'::public.vehicle_status AND (v.closed_by IS NOT NULL OR v.closed_at IS NOT NULL)
          THEN v.closed_at
        WHEN v_pallets = 26 OR v_weight = 21500
          THEN COALESCE(v.closed_at, now())
        ELSE NULL
      END
  WHERE v.id = _vehicle_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_shipment_item_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vehicle_id uuid;
  v_other_pallets numeric := 0;
  v_other_weight numeric := 0;
  v_new_pallets numeric := COALESCE(NEW.pallet_count, 0);
  v_new_weight numeric := COALESCE(NEW.pallet_count, 0) * COALESCE(NEW.pallet_weight, 0);
  v_product_name text := btrim(COALESCE(NEW.product_name, ''));
BEGIN
  SELECT s.vehicle_id
    INTO v_vehicle_id
  FROM public.shipments s
  WHERE s.id = NEW.shipment_id;

  IF v_product_name <> '' AND v_product_name <> 'Новий товар' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.products p
      WHERE p.is_active = true
        AND lower(btrim(p.name)) = lower(v_product_name)
    ) THEN
      RAISE EXCEPTION 'Оберіть товар зі списку';
    END IF;
  END IF;

  IF v_vehicle_id IS NULL OR v_new_pallets <= 0 OR v_new_weight <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT
    COALESCE(SUM(COALESCE(si.pallet_count, 0)), 0),
    COALESCE(SUM(COALESCE(si.pallet_count, 0) * COALESCE(si.pallet_weight, 0)), 0)
  INTO v_other_pallets, v_other_weight
  FROM public.shipment_items si
  JOIN public.shipments s ON s.id = si.shipment_id
  WHERE s.vehicle_id = v_vehicle_id
    AND (TG_OP <> 'UPDATE' OR si.id <> NEW.id);

  IF v_other_pallets + v_new_pallets > 26 THEN
    RAISE EXCEPTION 'Перевищено ліміт авто: максимум 26 палет';
  END IF;

  IF v_other_weight + v_new_weight > 21500 THEN
    RAISE EXCEPTION 'Перевищено ліміт авто: максимум 21500 кг';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_shipment_item_limits ON public.shipment_items;
CREATE TRIGGER trg_validate_shipment_item_limits
BEFORE INSERT OR UPDATE OF product_name, pallet_count, pallet_weight ON public.shipment_items
FOR EACH ROW
EXECUTE FUNCTION public.validate_shipment_item_limits();

UPDATE public.vehicles v
SET status = 'open'::public.vehicle_status,
    closed_at = NULL
WHERE v.closed_by IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.shipments s
    WHERE s.vehicle_id = v.id
  );

DO $$
DECLARE
  v_row record;
BEGIN
  FOR v_row IN SELECT id FROM public.vehicles LOOP
    PERFORM public.recompute_vehicle_totals_for(v_row.id);
  END LOOP;
END;
$$;
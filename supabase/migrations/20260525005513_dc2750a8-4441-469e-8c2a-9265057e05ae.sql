
-- A. Rewrite validate_shipment_item_limits to validate against product_dictionary + product_aliases
CREATE OR REPLACE FUNCTION public.validate_shipment_item_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_vehicle_id uuid;
  v_other_pallets numeric := 0;
  v_other_weight numeric := 0;
  v_new_pallets numeric := COALESCE(NEW.pallet_count, 0);
  v_new_weight numeric := COALESCE(NEW.pallet_count, 0) * COALESCE(NEW.pallet_weight, 0);
  v_product_name text := btrim(COALESCE(NEW.product_name, ''));
  v_product_norm text := lower(v_product_name);
BEGIN
  SELECT s.vehicle_id INTO v_vehicle_id
  FROM public.shipments s
  WHERE s.id = NEW.shipment_id;

  IF v_product_name <> '' AND v_product_name <> 'Новий товар' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.product_dictionary pd
      WHERE lower(btrim(pd.product_name_ua)) = v_product_norm
         OR lower(btrim(COALESCE(pd.product_name_en, ''))) = v_product_norm
         OR lower(btrim(pd.product_key)) = v_product_norm
    ) AND NOT EXISTS (
      SELECT 1
      FROM public.product_aliases pa
      WHERE lower(btrim(pa.alias)) = v_product_norm
         OR lower(btrim(pa.alias_normalized)) = v_product_norm
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
$function$;

-- B. Drop legacy FK + unused bridge column on product_dictionary
ALTER TABLE public.product_dictionary
  DROP CONSTRAINT IF EXISTS product_dictionary_source_product_id_fkey;

ALTER TABLE public.product_dictionary
  DROP COLUMN IF EXISTS source_product_id;


-- When a shipment_item's pallet_count decreases below the sum of distributed pallets,
-- trim distribution_items in reverse-FIFO order (latest distribution row loses pallets first).
-- Also clean up distribution_items when a shipment_item is deleted.

CREATE OR REPLACE FUNCTION public.trim_distribution_on_item_shrink()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_new_pallets numeric := COALESCE(NEW.pallet_count, 0);
  v_distributed numeric := 0;
  v_excess numeric;
  r record;
  v_take numeric;
BEGIN
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.pallet_count,0) = COALESCE(NEW.pallet_count,0) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(COALESCE(di.pallets,0)),0)
    INTO v_distributed
  FROM public.distribution_items di
  WHERE di.shipment_item_id = NEW.id;

  v_excess := v_distributed - v_new_pallets;
  IF v_excess <= 0 THEN
    RETURN NEW;
  END IF;

  -- Reverse FIFO: latest distribution (by created_at DESC) loses pallets first
  FOR r IN
    SELECT di.id, COALESCE(di.pallets,0) AS pallets, COALESCE(di.qty,0) AS qty
    FROM public.distribution_items di
    JOIN public.distributions d ON d.id = di.distribution_id
    WHERE di.shipment_item_id = NEW.id
      AND COALESCE(di.pallets,0) > 0
    ORDER BY d.created_at DESC, di.id DESC
  LOOP
    EXIT WHEN v_excess <= 0;
    v_take := LEAST(r.pallets, v_excess);
    IF v_take >= r.pallets THEN
      DELETE FROM public.distribution_items WHERE id = r.id;
    ELSE
      UPDATE public.distribution_items
        SET pallets = r.pallets - v_take,
            qty = GREATEST(0, r.qty - v_take * COALESCE(NEW.pallet_weight,0))
        WHERE id = r.id;
    END IF;
    v_excess := v_excess - v_take;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trim_distribution_on_item_shrink ON public.shipment_items;
CREATE TRIGGER trg_trim_distribution_on_item_shrink
AFTER UPDATE OF pallet_count ON public.shipment_items
FOR EACH ROW
EXECUTE FUNCTION public.trim_distribution_on_item_shrink();

CREATE OR REPLACE FUNCTION public.cleanup_distribution_on_item_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.distribution_items WHERE shipment_item_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_distribution_on_item_delete ON public.shipment_items;
CREATE TRIGGER trg_cleanup_distribution_on_item_delete
BEFORE DELETE ON public.shipment_items
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_distribution_on_item_delete();

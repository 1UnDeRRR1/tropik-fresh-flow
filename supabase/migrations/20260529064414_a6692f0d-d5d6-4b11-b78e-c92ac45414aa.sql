CREATE OR REPLACE FUNCTION public.trim_distribution_on_item_shrink()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_new      numeric := COALESCE(NEW.pallet_count, 0);
  v_excess   numeric;
  v_take     numeric;
  v_dist_sum numeric;
  r          record;
  v_offer    uuid;
  v_affected uuid[] := ARRAY[]::uuid[];
BEGIN
  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.pallet_count, 0) = COALESCE(NEW.pallet_count, 0) THEN
    RETURN NEW;
  END IF;

  -- 1. Snapshot offer_ids BEFORE any trim so offers whose parts get fully
  --    deleted are still re-synced (sync sets their linked_pallets = 0 and
  --    clears their distribution_items).
  SELECT COALESCE(array_agg(DISTINCT offer_id), ARRAY[]::uuid[])
    INTO v_affected
    FROM public.manager_offer_allocation_parts
   WHERE shipment_item_id = NEW.id;

  -- 2. Trim the allocation ledger to the new capacity (cross-offer reverse-FIFO).
  --    We intentionally do NOT set lovable.allow_ledger_trim here: the trim is
  --    performed directly via the helper, and the sync calls below run in
  --    derived-only mode (the ledger is already correct at that point).
  PERFORM public._trim_allocation_parts_to_capacity(NEW.id, v_new, NULL);

  -- 3. Defensive trim of distribution_items not covered by any allocation row
  --    (legacy / manual distributions without allocation_parts).
  SELECT COALESCE(SUM(COALESCE(di.pallets, 0)), 0)
    INTO v_dist_sum
    FROM public.distribution_items di
   WHERE di.shipment_item_id = NEW.id;

  v_excess := v_dist_sum - v_new;
  IF v_excess > 0 THEN
    FOR r IN
      SELECT di.id,
             COALESCE(di.pallets, 0) AS pallets,
             COALESCE(di.qty, 0)     AS qty
        FROM public.distribution_items di
        JOIN public.distributions d ON d.id = di.distribution_id
       WHERE di.shipment_item_id = NEW.id
         AND COALESCE(di.pallets, 0) > 0
       ORDER BY d.created_at DESC, di.id DESC
    LOOP
      EXIT WHEN v_excess <= 0;
      v_take := LEAST(r.pallets, v_excess);
      IF v_take >= r.pallets THEN
        DELETE FROM public.distribution_items WHERE id = r.id;
      ELSE
        UPDATE public.distribution_items
           SET pallets = r.pallets - v_take,
               qty     = GREATEST(0, r.qty - v_take * COALESCE(NEW.pallet_weight, 0))
         WHERE id = r.id;
      END IF;
      v_excess := v_excess - v_take;
    END LOOP;
  END IF;

  -- 4. Resync every snapshotted offer. allow_ledger_trim is NOT set, so sync
  --    runs in pure derived mode and just rebuilds responses / distribution
  --    rows from the (already-trimmed) ledger.
  FOREACH v_offer IN ARRAY v_affected LOOP
    PERFORM public.sync_manager_offer_distribution(v_offer);
  END LOOP;

  RETURN NEW;
END;
$function$;
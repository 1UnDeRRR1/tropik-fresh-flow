CREATE OR REPLACE FUNCTION public.rebalance_offer_allocation_for_item(
  p_offer_id         uuid,
  p_shipment_item_id uuid
)
RETURNS TABLE (
  old_allocated numeric,
  new_allocated numeric,
  reduced_by    numeric,
  remaining     numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_offer    public.manager_offers%ROWTYPE;
  v_item     public.shipment_items%ROWTYPE;
  v_capacity numeric;
  v_ordered  numeric;
  v_excess   numeric;
  v_take     numeric;
  r          record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  -- 1. Lock offer (serialize with FIFO RPC for the same offer).
  SELECT * INTO v_offer
    FROM public.manager_offers
   WHERE id = p_offer_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_not_found';
  END IF;

  -- 2. Lock shipment_item.
  SELECT * INTO v_item
    FROM public.shipment_items
   WHERE id = p_shipment_item_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shipment_item_not_found';
  END IF;

  -- 3. Authorization via EXISTING helpers (no new helpers introduced).
  IF NOT (
       public.is_admin(v_uid)
    OR public.owns_manager_offer(p_offer_id, v_uid)
    OR public.is_shipment_owner(v_item.shipment_id, v_uid)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_capacity := COALESCE(v_item.pallet_count, 0);

  -- 4. Lock the candidate allocation rows (plain SELECT, no aggregate -> FOR UPDATE valid).
  PERFORM 1
    FROM public.manager_offer_allocation_parts
   WHERE offer_id         = p_offer_id
     AND shipment_item_id = p_shipment_item_id
     AND status           = 'ordered'
   ORDER BY created_at, id
   FOR UPDATE;

  -- 5. Sum the (now locked) rows in a separate statement.
  SELECT COALESCE(SUM(pallets), 0)
    INTO v_ordered
    FROM public.manager_offer_allocation_parts
   WHERE offer_id         = p_offer_id
     AND shipment_item_id = p_shipment_item_id
     AND status           = 'ordered';

  old_allocated := v_ordered;
  v_excess     := v_ordered - v_capacity;

  IF v_excess <= 0 THEN
    -- Idempotent no-op path; still resync so callers can rely on responses.linked_pallets.
    PERFORM public.sync_manager_offer_distribution(p_offer_id);
    new_allocated := v_ordered;
    reduced_by    := 0;
    SELECT GREATEST(
      COALESCE((SELECT SUM(approved_pallets) FROM public.manager_offer_responses
                 WHERE offer_id = p_offer_id), 0)
      - COALESCE((SELECT SUM(pallets) FROM public.manager_offer_allocation_parts
                   WHERE offer_id = p_offer_id AND status = 'ordered'), 0), 0)
      INTO remaining;
    RETURN NEXT;
    RETURN;
  END IF;

  -- 6. Reverse-FIFO shrink. Re-select with FOR UPDATE (locks already held in this tx -> instant).
  FOR r IN
    SELECT id, pallets
      FROM public.manager_offer_allocation_parts
     WHERE offer_id         = p_offer_id
       AND shipment_item_id = p_shipment_item_id
       AND status           = 'ordered'
     ORDER BY created_at DESC, id DESC
     FOR UPDATE
  LOOP
    EXIT WHEN v_excess <= 0;
    v_take := LEAST(r.pallets, v_excess);
    IF v_take >= r.pallets THEN
      DELETE FROM public.manager_offer_allocation_parts WHERE id = r.id;
    ELSE
      UPDATE public.manager_offer_allocation_parts
         SET pallets = r.pallets - v_take
       WHERE id = r.id;
    END IF;
    v_excess := v_excess - v_take;
  END LOOP;

  -- 7. Resync responses.linked_pallets across the whole offer.
  PERFORM public.sync_manager_offer_distribution(p_offer_id);

  -- 8. Final accounting (plain reads).
  SELECT COALESCE(SUM(pallets), 0) INTO new_allocated
    FROM public.manager_offer_allocation_parts
   WHERE offer_id         = p_offer_id
     AND shipment_item_id = p_shipment_item_id
     AND status           = 'ordered';

  reduced_by := old_allocated - new_allocated;

  SELECT GREATEST(
    COALESCE((SELECT SUM(approved_pallets) FROM public.manager_offer_responses
               WHERE offer_id = p_offer_id), 0)
    - COALESCE((SELECT SUM(pallets) FROM public.manager_offer_allocation_parts
                 WHERE offer_id = p_offer_id AND status = 'ordered'), 0), 0)
    INTO remaining;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.rebalance_offer_allocation_for_item(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.rebalance_offer_allocation_for_item(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.rebalance_offer_allocation_for_item(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rebalance_offer_allocation_for_item(uuid, uuid) TO service_role;
CREATE OR REPLACE FUNCTION public._trim_allocation_parts_to_capacity(
  p_shipment_item_id uuid,
  p_cap              numeric,
  p_only_offer_id    uuid DEFAULT NULL
) RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sum             numeric := 0;
  v_take            numeric;
  r                 record;
  v_excess          numeric;
  v_affected_offers uuid[] := ARRAY[]::uuid[];
  v_offer           uuid;
BEGIN
  -- Lock candidate rows BEFORE summing (FOR UPDATE without aggregate).
  PERFORM 1
    FROM public.manager_offer_allocation_parts
   WHERE shipment_item_id = p_shipment_item_id
     AND status = 'ordered'
     AND (p_only_offer_id IS NULL OR offer_id = p_only_offer_id)
   ORDER BY created_at, id
   FOR UPDATE;

  SELECT COALESCE(SUM(pallets), 0) INTO v_sum
    FROM public.manager_offer_allocation_parts
   WHERE shipment_item_id = p_shipment_item_id
     AND status = 'ordered'
     AND (p_only_offer_id IS NULL OR offer_id = p_only_offer_id);

  v_excess := v_sum - GREATEST(COALESCE(p_cap, 0), 0);
  IF v_excess <= 0 THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT id, offer_id, pallets
      FROM public.manager_offer_allocation_parts
     WHERE shipment_item_id = p_shipment_item_id
       AND status = 'ordered'
       AND (p_only_offer_id IS NULL OR offer_id = p_only_offer_id)
     ORDER BY created_at DESC, id DESC
     FOR UPDATE
  LOOP
    EXIT WHEN v_excess <= 0;
    v_take := LEAST(r.pallets, v_excess);
    IF v_take >= r.pallets THEN
      DELETE FROM public.manager_offer_allocation_parts WHERE id = r.id;
    ELSE
      UPDATE public.manager_offer_allocation_parts
         SET pallets    = r.pallets - v_take,
             updated_at = now()
       WHERE id = r.id;
    END IF;
    v_excess := v_excess - v_take;
    v_affected_offers := v_affected_offers || r.offer_id;
  END LOOP;

  FOREACH v_offer IN ARRAY ARRAY(SELECT DISTINCT unnest(v_affected_offers)) LOOP
    RETURN NEXT v_offer;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public._trim_allocation_parts_to_capacity(uuid, numeric, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._trim_allocation_parts_to_capacity(uuid, numeric, uuid) FROM anon;
REVOKE ALL ON FUNCTION public._trim_allocation_parts_to_capacity(uuid, numeric, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._trim_allocation_parts_to_capacity(uuid, numeric, uuid) TO service_role;

COMMENT ON FUNCTION public._trim_allocation_parts_to_capacity(uuid, numeric, uuid) IS
  'Stage 3C / Migration 1. Internal-only ledger trim. NEVER grant EXECUTE to authenticated or anon. '
  'Intended callers (reach via SECURITY DEFINER ownership, not via direct grant): '
  'trigger trim_distribution_on_item_shrink, RPC rebalance_offer_allocation_for_item, '
  'and the opt-in B0 block of sync_manager_offer_distribution. '
  'Performs reverse-FIFO shrink of manager_offer_allocation_parts (status=ordered) for a given '
  'shipment_item_id down to p_cap; optional p_only_offer_id scopes the trim to a single offer. '
  'Returns the distinct set of offer_ids whose rows were touched.';
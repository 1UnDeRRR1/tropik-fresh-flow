-- Atomic RPC: link a manager_offer to an exact shipment_item.
-- - validates product + origin_country match
-- - rejects caliber mismatch unless allow_caliber_mismatch = true
-- - enforces single-valued shipment_items.linked_offer_id per shipment_item
-- - clears any previous shipment_item linked to the same offer (replace target)
-- - calls existing sync_manager_offer_distribution(_offer_id) to populate distributions
-- - returns remaining_to_load AFTER sync
-- Does NOT overwrite shipment_item.caliber.
-- approved_pallets = 0 is treated as refusal and is not summed into remaining_to_load.

CREATE OR REPLACE FUNCTION public.link_manager_offer_to_shipment_item(
  p_offer_id uuid,
  p_shipment_item_id uuid,
  p_allow_caliber_mismatch boolean DEFAULT false
)
RETURNS TABLE (
  remaining_to_load numeric,
  shipment_item_id uuid,
  shipment_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offer       public.manager_offers%ROWTYPE;
  v_item        public.shipment_items%ROWTYPE;
  v_ship        public.shipments%ROWTYPE;
  v_caller      uuid := auth.uid();
  v_is_staff    boolean;
  v_is_owner    boolean;
  v_approved    numeric;
  v_linked      numeric;
  v_remaining   numeric;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT * INTO v_offer FROM public.manager_offers WHERE id = p_offer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_not_found';
  END IF;

  SELECT * INTO v_item FROM public.shipment_items WHERE id = p_shipment_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shipment_item_not_found';
  END IF;

  SELECT * INTO v_ship FROM public.shipments WHERE id = v_item.shipment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shipment_not_found';
  END IF;

  -- Permission: staff who owns the shipment, or admin
  v_is_staff := public.is_staff(v_caller);
  v_is_owner := public.is_shipment_owner(v_item.shipment_id, v_caller);
  IF NOT (public.is_admin(v_caller) OR (v_is_staff AND v_is_owner) OR v_offer.created_by = v_caller) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_ship.status IN ('cancelled','archived') THEN
    RAISE EXCEPTION 'shipment_not_active';
  END IF;

  -- Product + country must match
  IF lower(trim(coalesce(v_item.product_name,''))) <> lower(trim(coalesce(v_offer.product_name,''))) THEN
    RAISE EXCEPTION 'product_mismatch';
  END IF;
  IF v_offer.origin_country IS NOT NULL
     AND v_item.origin_country IS NOT NULL
     AND lower(trim(v_item.origin_country)) <> lower(trim(v_offer.origin_country)) THEN
    RAISE EXCEPTION 'country_mismatch';
  END IF;

  -- Caliber gate
  IF coalesce(nullif(trim(coalesce(v_item.caliber,'')),''), '') IS DISTINCT FROM
     coalesce(nullif(trim(coalesce(v_offer.caliber,'')),''), '')
     AND nullif(trim(coalesce(v_item.caliber,'')),'') IS NOT NULL
     AND nullif(trim(coalesce(v_offer.caliber,'')),'') IS NOT NULL
     AND NOT p_allow_caliber_mismatch THEN
    RAISE EXCEPTION 'caliber_mismatch';
  END IF;

  -- Reject if target item already linked to a DIFFERENT offer
  IF v_item.linked_offer_id IS NOT NULL AND v_item.linked_offer_id <> p_offer_id THEN
    RAISE EXCEPTION 'shipment_item_already_linked';
  END IF;

  -- Move link: clear any other shipment_items pointing to this offer
  UPDATE public.shipment_items
     SET linked_offer_id = NULL
   WHERE linked_offer_id = p_offer_id
     AND id <> p_shipment_item_id;

  -- Set new link
  UPDATE public.shipment_items
     SET linked_offer_id = p_offer_id
   WHERE id = p_shipment_item_id;

  UPDATE public.manager_offers
     SET linked_shipment_id = v_item.shipment_id,
         updated_at = now()
   WHERE id = p_offer_id;

  -- Rebuild distributions via existing sync
  PERFORM public.sync_manager_offer_distribution(p_offer_id);

  -- Compute remaining_to_load = SUM(approved>0) - SUM(linked)
  SELECT coalesce(sum(approved_pallets) FILTER (WHERE approved_pallets > 0), 0),
         coalesce(sum(linked_pallets), 0)
    INTO v_approved, v_linked
    FROM public.manager_offer_responses
   WHERE offer_id = p_offer_id;

  v_remaining := greatest(v_approved - v_linked, 0);

  RETURN QUERY SELECT v_remaining, p_shipment_item_id, v_item.shipment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.link_manager_offer_to_shipment_item(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_manager_offer_to_shipment_item(uuid, uuid, boolean) TO authenticated;
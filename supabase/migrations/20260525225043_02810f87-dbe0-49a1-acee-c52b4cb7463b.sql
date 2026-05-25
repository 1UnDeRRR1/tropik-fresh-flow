-- Rollback RPC for birth-flow created positions.
-- Safely deletes operational_positions + position_events ONLY IF the position
-- has no other links (no manager_offers, no shipment_items, no allocation parts,
-- no shipment links). Restricted to super_admin/admin/import_manager.
CREATE OR REPLACE FUNCTION public.rpc_position_rollback_birth(
  p_position_id uuid
)
RETURNS TABLE (rolled_back boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_pos public.operational_positions%ROWTYPE;
  v_offer_count int;
  v_ship_item_count int;
  v_alloc_count int;
  v_link_count int;
BEGIN
  IF v_caller IS NULL THEN
    RETURN QUERY SELECT false, 'unauthenticated'::text;
    RETURN;
  END IF;

  IF NOT (
    public.has_role(v_caller, 'super_admin'::app_role)
    OR public.has_role(v_caller, 'admin'::app_role)
    OR public.has_role(v_caller, 'import_manager'::app_role)
  ) THEN
    RETURN QUERY SELECT false, 'forbidden'::text;
    RETURN;
  END IF;

  SELECT * INTO v_pos FROM public.operational_positions WHERE position_id = p_position_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'position_not_found'::text;
    RETURN;
  END IF;

  -- Only allow rollback of positions that originated from a manager_offer birth.
  IF COALESCE(v_pos.source_context, '') <> 'manager_offer' THEN
    RETURN QUERY SELECT false, 'not_birth_position'::text;
    RETURN;
  END IF;

  -- Ensure NO other live links exist.
  SELECT COUNT(*) INTO v_offer_count
    FROM public.manager_offers WHERE position_id = p_position_id;
  SELECT COUNT(*) INTO v_ship_item_count
    FROM public.shipment_items WHERE position_id = p_position_id;
  SELECT COUNT(*) INTO v_alloc_count
    FROM public.manager_offer_allocation_parts WHERE position_id = p_position_id;
  BEGIN
    SELECT COUNT(*) INTO v_link_count
      FROM public.position_shipment_links WHERE position_id = p_position_id;
  EXCEPTION WHEN undefined_table THEN
    v_link_count := 0;
  END;

  IF v_offer_count > 0 OR v_ship_item_count > 0 OR v_alloc_count > 0 OR v_link_count > 0 THEN
    RETURN QUERY SELECT false, 'position_has_links'::text;
    RETURN;
  END IF;

  -- Safe to delete events then position.
  DELETE FROM public.position_events WHERE position_id = p_position_id;
  DELETE FROM public.operational_positions WHERE position_id = p_position_id;

  RETURN QUERY SELECT true, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_position_rollback_birth(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_position_rollback_birth(uuid) TO authenticated;
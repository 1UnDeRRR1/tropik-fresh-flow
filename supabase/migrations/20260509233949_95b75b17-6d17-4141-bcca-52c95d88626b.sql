
-- 1. Branch visibility helper: free pallets remaining on a shipment item
CREATE OR REPLACE FUNCTION public.shipment_item_free_pallets(_item_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(
    COALESCE(si.pallet_count, 0)
    - COALESCE((SELECT SUM(di.pallets) FROM public.distribution_items di WHERE di.shipment_item_id = si.id), 0),
    0
  )
  FROM public.shipment_items si
  WHERE si.id = _item_id
$$;

CREATE OR REPLACE FUNCTION public.shipment_has_free_pallets(_shipment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.shipment_items si
    WHERE si.shipment_id = _shipment_id
      AND COALESCE(si.pallet_count, 0)
        > COALESCE((SELECT SUM(di.pallets) FROM public.distribution_items di WHERE di.shipment_item_id = si.id), 0)
  )
$$;

-- 2. Drop broad branch SELECT policies
DROP POLICY IF EXISTS "shipments branch read all" ON public.shipments;
DROP POLICY IF EXISTS "shipment_items branch read all" ON public.shipment_items;

-- 3. Replace shipments branch SELECT with scoped version
DROP POLICY IF EXISTS "shipments branch read distributed" ON public.shipments;
CREATE POLICY "shipments branch read scoped"
ON public.shipments FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.distributions d
    WHERE d.shipment_id = shipments.id
      AND d.branch_id = public.user_branch_id(auth.uid())
  )
  OR public.shipment_has_free_pallets(shipments.id)
);

-- 4. Replace shipment_items branch SELECT with scoped version
DROP POLICY IF EXISTS "shipment_items branch read" ON public.shipment_items;
CREATE POLICY "shipment_items branch read scoped"
ON public.shipment_items FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.distributions d
    WHERE d.shipment_id = shipment_items.shipment_id
      AND d.branch_id = public.user_branch_id(auth.uid())
  )
  OR public.shipment_item_free_pallets(shipment_items.id) > 0
);

-- 5. Tighten profiles admin update — keep the role check on WITH CHECK too
DROP POLICY IF EXISTS "profiles admin update all" ON public.profiles;
CREATE POLICY "profiles admin update all"
ON public.profiles FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role));

-- 6. Fix mutable search_path on trigger-only functions
ALTER FUNCTION public.touch_updated_at() SET search_path = public;
ALTER FUNCTION public.touch_branch_transfer_offers() SET search_path = public;

-- 7. Revoke EXECUTE from anon/authenticated on internal SECURITY DEFINER functions.
--    Keep RLS helpers (has_role, is_staff, is_admin, user_branch_id, shipment_*_free_pallets) callable.
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.touch_updated_at()',
    'public.touch_branch_transfer_offers()',
    'public.handle_new_user()',
    'public.calc_shipment_item_usd()',
    'public.calc_shipment_logistics_usd()',
    'public.calc_shipment_item_costs()',
    'public.log_shipment_item_changes()',
    'public.log_shipment_eta_changes()',
    'public.recompute_shipment_items_costs()',
    'public.recompute_vehicle_item_costs(uuid, uuid)',
    'public.recompute_vehicle_totals_for(uuid)',
    'public.ensure_shipment_fx_snapshot(uuid)',
    'public.trg_sh_recompute_vehicle()',
    'public.trg_si_recompute_vehicle()',
    'public.trg_si_recompute_vehicle_costs()',
    'public.next_vehicle_sequence(text)',
    'public.delete_invalid_branch_request_item()',
    'public.delete_invalid_loading_plan_item()',
    'public.delete_invalid_transfer_request_item()',
    'public.delete_invalid_shipment_item()',
    'public.normalize_loading_plan_name()',
    'public.normalize_transfer_request_item_name()',
    'public.normalize_shipment_item_name()',
    'public.normalize_branch_request_item_name()',
    'public.expire_branch_transfer_offers()',
    'public.apply_branch_transfer_offer()',
    'public.validate_branch_transfer_offer()'
  ]
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated, public', fn);
  END LOOP;
END $$;

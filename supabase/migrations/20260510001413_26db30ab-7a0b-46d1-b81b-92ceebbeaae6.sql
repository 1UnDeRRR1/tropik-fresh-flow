-- 1) Drop the broad branch-scoped SELECT policies on base tables.
--    After this, "branch" users cannot read shipments / shipment_items directly
--    (and therefore cannot select unit_price, unit_price_usd, invoice_price,
--    indicative_price, cost_price_usd, fx_rate_used, logistics_cost, etc.).
DROP POLICY IF EXISTS "shipment_items branch read scoped" ON public.shipment_items;
DROP POLICY IF EXISTS "shipments branch read scoped"      ON public.shipments;

-- 2) Branch-safe view of shipments (no purchase / cost-of-goods fields).
--    Staff see everything; branch sees only shipments where they have a
--    distribution OR where free pallets exist (matches old branch RLS).
CREATE OR REPLACE VIEW public.shipments_branch AS
SELECT
  s.id,
  s.code,
  s.country,
  s.eta,
  s.arrived_at,
  s.loading_date,
  s.status,
  s.created_at,
  s.updated_at
FROM public.shipments s
WHERE
  public.is_staff(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.distributions d
    WHERE d.shipment_id = s.id
      AND d.branch_id   = public.user_branch_id(auth.uid())
  )
  OR public.shipment_has_free_pallets(s.id);

-- 3) Branch-safe view of shipment_items (excludes ALL purchase-price columns:
--    unit_price, unit_price_usd, indicative_price, invoice_price, cost_price_usd,
--    fx_rate_used, price_currency, customs_*).
--    Exposes only product / caliber / specification / pallet info / final landed cost.
CREATE OR REPLACE VIEW public.shipment_items_branch AS
SELECT
  si.id,
  si.shipment_id,
  si.product_name,
  si.origin_country,
  si.caliber,
  si.variety,
  si.sku,
  si.unit,
  si.qty,
  si.weight_kg,
  si.pallet_count,
  si.pallet_weight,
  si.final_cost_indicative,
  si.final_cost_invoice,
  public.shipment_item_free_pallets(si.id) AS free_pallets,
  si.created_at
FROM public.shipment_items si
WHERE
  public.is_staff(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.distributions d
    WHERE d.shipment_id = si.shipment_id
      AND d.branch_id   = public.user_branch_id(auth.uid())
  )
  OR public.shipment_item_free_pallets(si.id) > 0;

-- 4) Allow authenticated clients to read the views.
GRANT SELECT ON public.shipments_branch       TO authenticated;
GRANT SELECT ON public.shipment_items_branch  TO authenticated;

-- Make sure anon cannot read them (defense in depth).
REVOKE ALL ON public.shipments_branch      FROM anon;
REVOKE ALL ON public.shipment_items_branch FROM anon;
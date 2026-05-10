
CREATE OR REPLACE FUNCTION public.loading_plan_loaded_totals()
RETURNS TABLE(plan_id uuid, loaded numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lp.id,
         COALESCE(SUM(si.pallet_count), 0)::numeric AS loaded
  FROM public.loading_plan lp
  LEFT JOIN public.shipment_items si
    ON lower(btrim(si.product_name)) = lower(btrim(lp.product_name))
  LEFT JOIN public.shipments s
    ON s.id = si.shipment_id
  WHERE lp.is_active
    AND (
      si.id IS NULL OR (
        (lp.country IS NULL OR lp.country = '' OR
          lower(btrim(COALESCE(si.origin_country, s.country))) = lower(btrim(lp.country)))
        AND (lp.count_existing OR COALESCE(si.created_at, s.created_at) >= lp.created_at)
      )
    )
  GROUP BY lp.id;
$$;

REVOKE ALL ON FUNCTION public.loading_plan_loaded_totals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.loading_plan_loaded_totals() TO authenticated;

CREATE OR REPLACE FUNCTION public.loading_plan_items(_plan_id uuid)
RETURNS TABLE(
  shipment_id uuid,
  product_name text,
  origin_country text,
  pallet_count numeric,
  created_at timestamptz,
  shipment_code text,
  shipment_country text,
  shipment_created_at timestamptz,
  shipment_eta date,
  supplier_name text,
  vehicle_code text,
  vehicle_eta date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT si.shipment_id,
         si.product_name,
         si.origin_country,
         si.pallet_count,
         si.created_at,
         s.code,
         s.country,
         s.created_at,
         s.eta,
         sup.name,
         v.code,
         v.eta
  FROM public.loading_plan lp
  JOIN public.shipment_items si
    ON lower(btrim(si.product_name)) = lower(btrim(lp.product_name))
  JOIN public.shipments s
    ON s.id = si.shipment_id
  LEFT JOIN public.suppliers sup ON sup.id = s.supplier_id
  LEFT JOIN public.vehicles v ON v.id = s.vehicle_id
  WHERE lp.id = _plan_id
    AND (lp.country IS NULL OR lp.country = '' OR
         lower(btrim(COALESCE(si.origin_country, s.country))) = lower(btrim(lp.country)))
    AND (lp.count_existing OR COALESCE(si.created_at, s.created_at) >= lp.created_at)
  ORDER BY COALESCE(si.created_at, s.created_at) DESC;
$$;

REVOKE ALL ON FUNCTION public.loading_plan_items(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.loading_plan_items(uuid) TO authenticated;

-- Fix vehicle_capacity_v: enforce SECURITY INVOKER and inline role guard
CREATE OR REPLACE VIEW public.vehicle_capacity_v
WITH (security_invoker = true) AS
SELECT v.id AS vehicle_id,
    26 AS max_pallets,
    21500::numeric AS max_gross_kg,
    COALESCE(f.fact_pallets, 0) AS fact_pallets,
    COALESCE(f.fact_gross_kg, 0::numeric) AS fact_gross_kg,
    COALESCE(r.reserved_pallets, 0) AS reserved_pallets,
    COALESCE(r.reserved_gross_kg, 0::numeric) AS reserved_gross_kg,
    GREATEST(0, 26 - COALESCE(f.fact_pallets, 0) - COALESCE(r.reserved_pallets, 0)) AS free_pallets,
    GREATEST(0::numeric, 21500::numeric - COALESCE(f.fact_gross_kg, 0::numeric) - COALESCE(r.reserved_gross_kg, 0::numeric)) AS free_gross_kg
FROM public.vehicles v
LEFT JOIN (
    SELECT s.vehicle_id,
        sum(COALESCE(si.pallet_count, 0::numeric))::integer AS fact_pallets,
        sum(COALESCE(si.gross_weight_kg, si.net_weight_kg, COALESCE(si.pallet_count, 0::numeric) * COALESCE(si.pallet_weight, 0::numeric))) AS fact_gross_kg
    FROM public.shipment_items si
    JOIN public.shipments s ON s.id = si.shipment_id
    WHERE s.vehicle_id IS NOT NULL
    GROUP BY s.vehicle_id
) f ON f.vehicle_id = v.id
LEFT JOIN (
    SELECT vr.vehicle_id,
        sum(vr.pallets)::integer AS reserved_pallets,
        sum(vr.gross_kg) AS reserved_gross_kg
    FROM public.vehicle_reserves vr
    WHERE vr.status = 'active'::reserve_status
    GROUP BY vr.vehicle_id
) r ON r.vehicle_id = v.id
WHERE
    public.has_role(auth.uid(), 'import_manager'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'logistics'::public.app_role);

-- Ensure grants are tight: anon has no access; authenticated may SELECT but the
-- inline role guard restricts rows to staff (import_manager/admin/super_admin/logistics).
REVOKE ALL ON public.vehicle_capacity_v FROM PUBLIC;
REVOKE ALL ON public.vehicle_capacity_v FROM anon;
GRANT SELECT ON public.vehicle_capacity_v TO authenticated;
GRANT ALL ON public.vehicle_capacity_v TO service_role;
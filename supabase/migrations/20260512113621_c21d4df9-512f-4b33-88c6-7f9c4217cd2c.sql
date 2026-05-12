DROP FUNCTION IF EXISTS public.active_shipments_overview();

CREATE OR REPLACE FUNCTION public.active_shipments_overview()
 RETURNS TABLE(shipment_id uuid, shipment_code text, status text, eta date, manager_id uuid, manager_name text, product_name text, caliber text, country text, pallet_count numeric, pallet_weight numeric, final_cost_indicative numeric, final_cost_invoice numeric, shipment_item_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT s.id,
         s.code,
         s.status::text,
         s.eta,
         s.import_manager_id,
         COALESCE(p.full_name, im.full_name, 'Менеджер'),
         si.product_name,
         si.caliber,
         COALESCE(si.origin_country, s.country),
         COALESCE(si.pallet_count, 0),
         COALESCE(si.pallet_weight, 0),
         COALESCE(si.final_cost_indicative, 0),
         COALESCE(si.final_cost_invoice, 0),
         si.id
    FROM public.shipments s
    JOIN public.shipment_items si ON si.shipment_id = s.id
    LEFT JOIN public.profiles p ON p.id = s.import_manager_id
    LEFT JOIN public.import_managers im ON im.user_id = s.import_manager_id
   WHERE public.is_staff(auth.uid())
     AND s.status NOT IN ('cancelled','arrived','completed')
     AND (s.eta IS NULL OR s.eta > CURRENT_DATE)
     AND COALESCE(si.pallet_count, 0) > 0;
$function$;
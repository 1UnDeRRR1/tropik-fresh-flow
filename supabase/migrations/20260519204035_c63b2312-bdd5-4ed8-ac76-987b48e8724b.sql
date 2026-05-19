
CREATE OR REPLACE FUNCTION public.can_access_manager_offer(_offer_id uuid, _branch_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.manager_offers o
    WHERE o.id = _offer_id
      AND o.status IN ('active','in_work','confirmed','linked','closed','deleted')
      AND (
        o.target_mode = 'all'
        OR EXISTS (
          SELECT 1
          FROM public.manager_offer_targets t
          WHERE t.offer_id = o.id
            AND t.branch_id = _branch_id
        )
      )
  )
$function$;

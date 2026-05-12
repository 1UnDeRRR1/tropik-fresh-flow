CREATE OR REPLACE FUNCTION public.shipments_apply_supplier_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  owner_manager_id uuid;
BEGIN
  IF NEW.supplier_id IS NOT NULL THEN
    SELECT s.import_manager_id
      INTO owner_manager_id
      FROM public.suppliers s
     WHERE s.id = NEW.supplier_id;

    IF owner_manager_id IS NOT NULL THEN
      NEW.import_manager_id := owner_manager_id;
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.import_manager_id IS NULL THEN
    SELECT im.id
      INTO owner_manager_id
      FROM public.import_managers im
     WHERE im.user_id = COALESCE(NEW.created_by, auth.uid())
     LIMIT 1;

    NEW.import_manager_id := COALESCE(owner_manager_id, NEW.import_manager_id);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_shipment_owner(_shipment_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.is_admin(_user_id) OR EXISTS (
    SELECT 1
    FROM public.shipments s
    LEFT JOIN public.suppliers sup ON sup.id = s.supplier_id
    WHERE s.id = _shipment_id
      AND (
        (s.import_manager_id IS NOT NULL AND s.import_manager_id IN (SELECT public.effective_manager_ids(_user_id)))
        OR (s.created_by = _user_id)
        OR (sup.import_manager_id IS NOT NULL AND sup.import_manager_id IN (SELECT public.effective_manager_ids(_user_id)))
        OR (s.supplier_id IS NOT NULL AND public.can_access_supplier(s.supplier_id, _user_id))
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_close_vehicle(_vehicle_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.is_admin(_user_id)
      OR EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = _vehicle_id AND v.created_by = _user_id)
      OR EXISTS (
        SELECT 1 FROM public.shipments s
        WHERE s.vehicle_id = _vehicle_id
          AND (
            s.created_by = _user_id
            OR (s.import_manager_id IS NOT NULL AND s.import_manager_id IN (SELECT public.effective_manager_ids(_user_id)))
          )
      )
$$;

CREATE OR REPLACE FUNCTION public.is_vehicle_coloader(_vehicle_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT _vehicle_id IS NOT NULL AND (
    public.is_admin(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.shipments s
      WHERE s.vehicle_id = _vehicle_id
        AND (
          s.created_by = _user_id
          OR (s.import_manager_id IS NOT NULL AND s.import_manager_id IN (SELECT public.effective_manager_ids(_user_id)))
        )
    )
  )
$$;

UPDATE public.shipments s
   SET import_manager_id = im.id
  FROM public.import_managers im
 WHERE s.import_manager_id = im.user_id
   AND s.import_manager_id IS DISTINCT FROM im.id;
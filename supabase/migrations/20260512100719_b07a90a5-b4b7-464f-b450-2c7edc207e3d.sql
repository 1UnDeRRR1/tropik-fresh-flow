
CREATE OR REPLACE FUNCTION public.shipments_apply_supplier_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  owner_uid uuid;
BEGIN
  IF NEW.supplier_id IS NOT NULL THEN
    SELECT im.user_id
      INTO owner_uid
      FROM public.suppliers s
      LEFT JOIN public.import_managers im ON im.id = s.import_manager_id
     WHERE s.id = NEW.supplier_id;

    IF owner_uid IS NOT NULL THEN
      NEW.import_manager_id := owner_uid;
      RETURN NEW;
    END IF;
  END IF;

  -- Fallback: keep provided value, or default to creator
  IF NEW.import_manager_id IS NULL THEN
    NEW.import_manager_id := COALESCE(NEW.created_by, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shipments_apply_supplier_owner ON public.shipments;
CREATE TRIGGER trg_shipments_apply_supplier_owner
BEFORE INSERT OR UPDATE OF supplier_id, import_manager_id ON public.shipments
FOR EACH ROW EXECUTE FUNCTION public.shipments_apply_supplier_owner();

-- Backfill: align existing shipments with their supplier's owner
UPDATE public.shipments s
   SET import_manager_id = im.user_id
  FROM public.suppliers sup
  JOIN public.import_managers im ON im.id = sup.import_manager_id
 WHERE s.supplier_id = sup.id
   AND im.user_id IS NOT NULL
   AND (s.import_manager_id IS DISTINCT FROM im.user_id);

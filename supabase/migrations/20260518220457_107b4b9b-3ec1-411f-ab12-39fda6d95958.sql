UPDATE public.manager_offers o
   SET status = 'active',
       linked_shipment_id = NULL
 WHERE o.status = 'linked'
   AND o.linked_shipment_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.shipments s WHERE s.id = o.linked_shipment_id);

CREATE OR REPLACE FUNCTION public.unlink_manager_offers_on_shipment_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.manager_offers
     SET status = 'active',
         linked_shipment_id = NULL
   WHERE linked_shipment_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_unlink_manager_offers_on_shipment_delete ON public.shipments;
CREATE TRIGGER trg_unlink_manager_offers_on_shipment_delete
BEFORE DELETE ON public.shipments
FOR EACH ROW EXECUTE FUNCTION public.unlink_manager_offers_on_shipment_delete();
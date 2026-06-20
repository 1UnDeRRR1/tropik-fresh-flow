CREATE TRIGGER zz_99_log_shipment_changes
AFTER UPDATE ON public.shipments
FOR EACH ROW
WHEN (OLD IS DISTINCT FROM NEW)
EXECUTE FUNCTION public.log_shipments_changes();
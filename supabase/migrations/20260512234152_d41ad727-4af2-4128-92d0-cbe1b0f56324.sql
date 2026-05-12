DROP TRIGGER IF EXISTS shipments_apply_supplier_owner_before_ins_upd ON public.shipments;

CREATE TRIGGER shipments_apply_supplier_owner_before_ins_upd
BEFORE INSERT OR UPDATE OF supplier_id, import_manager_id, created_by
ON public.shipments
FOR EACH ROW
EXECUTE FUNCTION public.shipments_apply_supplier_owner();
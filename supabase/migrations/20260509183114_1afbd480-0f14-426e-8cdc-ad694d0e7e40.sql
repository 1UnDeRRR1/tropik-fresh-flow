DELETE FROM public.shipment_items
WHERE COALESCE(BTRIM(product_name), '') = ''
   OR COALESCE(pallet_count, 0) <= 0;

DELETE FROM public.branch_request_items
WHERE COALESCE(BTRIM(product_name), '') = ''
   OR COALESCE(qty, 0) <= 0;

DELETE FROM public.transfer_request_items
WHERE COALESCE(BTRIM(product_name), '') = ''
   OR COALESCE(qty, 0) <= 0;

DELETE FROM public.loading_plan
WHERE COALESCE(BTRIM(product_name), '') = ''
   OR COALESCE(planned_pallets, 0) <= 0;

CREATE OR REPLACE FUNCTION public.normalize_shipment_item_name()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.product_name := BTRIM(COALESCE(NEW.product_name, ''));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_branch_request_item_name()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.product_name := BTRIM(COALESCE(NEW.product_name, ''));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_transfer_request_item_name()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.product_name := BTRIM(COALESCE(NEW.product_name, ''));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_loading_plan_name()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.product_name := BTRIM(COALESCE(NEW.product_name, ''));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_invalid_shipment_item()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF COALESCE(BTRIM(NEW.product_name), '') = '' OR COALESCE(NEW.pallet_count, 0) <= 0 THEN
    DELETE FROM public.shipment_items WHERE id = NEW.id;
    RETURN NULL;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_invalid_branch_request_item()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF COALESCE(BTRIM(NEW.product_name), '') = '' OR COALESCE(NEW.qty, 0) <= 0 THEN
    DELETE FROM public.branch_request_items WHERE id = NEW.id;
    RETURN NULL;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_invalid_transfer_request_item()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF COALESCE(BTRIM(NEW.product_name), '') = '' OR COALESCE(NEW.qty, 0) <= 0 THEN
    DELETE FROM public.transfer_request_items WHERE id = NEW.id;
    RETURN NULL;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_invalid_loading_plan_item()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF COALESCE(BTRIM(NEW.product_name), '') = '' OR COALESCE(NEW.planned_pallets, 0) <= 0 THEN
    DELETE FROM public.loading_plan WHERE id = NEW.id;
    RETURN NULL;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_shipment_item_name ON public.shipment_items;
CREATE TRIGGER trg_normalize_shipment_item_name
BEFORE INSERT OR UPDATE ON public.shipment_items
FOR EACH ROW
EXECUTE FUNCTION public.normalize_shipment_item_name();

DROP TRIGGER IF EXISTS trg_delete_invalid_shipment_item ON public.shipment_items;
CREATE TRIGGER trg_delete_invalid_shipment_item
AFTER INSERT OR UPDATE ON public.shipment_items
FOR EACH ROW
EXECUTE FUNCTION public.delete_invalid_shipment_item();

DROP TRIGGER IF EXISTS trg_normalize_branch_request_item_name ON public.branch_request_items;
CREATE TRIGGER trg_normalize_branch_request_item_name
BEFORE INSERT OR UPDATE ON public.branch_request_items
FOR EACH ROW
EXECUTE FUNCTION public.normalize_branch_request_item_name();

DROP TRIGGER IF EXISTS trg_delete_invalid_branch_request_item ON public.branch_request_items;
CREATE TRIGGER trg_delete_invalid_branch_request_item
AFTER INSERT OR UPDATE ON public.branch_request_items
FOR EACH ROW
EXECUTE FUNCTION public.delete_invalid_branch_request_item();

DROP TRIGGER IF EXISTS trg_normalize_transfer_request_item_name ON public.transfer_request_items;
CREATE TRIGGER trg_normalize_transfer_request_item_name
BEFORE INSERT OR UPDATE ON public.transfer_request_items
FOR EACH ROW
EXECUTE FUNCTION public.normalize_transfer_request_item_name();

DROP TRIGGER IF EXISTS trg_delete_invalid_transfer_request_item ON public.transfer_request_items;
CREATE TRIGGER trg_delete_invalid_transfer_request_item
AFTER INSERT OR UPDATE ON public.transfer_request_items
FOR EACH ROW
EXECUTE FUNCTION public.delete_invalid_transfer_request_item();

DROP TRIGGER IF EXISTS trg_normalize_loading_plan_name ON public.loading_plan;
CREATE TRIGGER trg_normalize_loading_plan_name
BEFORE INSERT OR UPDATE ON public.loading_plan
FOR EACH ROW
EXECUTE FUNCTION public.normalize_loading_plan_name();

DROP TRIGGER IF EXISTS trg_delete_invalid_loading_plan_item ON public.loading_plan;
CREATE TRIGGER trg_delete_invalid_loading_plan_item
AFTER INSERT OR UPDATE ON public.loading_plan
FOR EACH ROW
EXECUTE FUNCTION public.delete_invalid_loading_plan_item();
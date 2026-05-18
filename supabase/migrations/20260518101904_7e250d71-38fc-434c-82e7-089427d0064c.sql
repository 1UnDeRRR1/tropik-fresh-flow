
UPDATE public.suppliers SET name = upper(name) WHERE name IS NOT NULL AND name <> upper(name);
UPDATE public.suppliers SET code_base = upper(code_base) WHERE code_base IS NOT NULL AND code_base <> upper(code_base);
UPDATE public.shipments SET code = upper(code) WHERE code IS NOT NULL AND code <> upper(code);

CREATE OR REPLACE FUNCTION public.suppliers_uppercase_tg()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.name IS NOT NULL THEN NEW.name := upper(NEW.name); END IF;
  IF NEW.code_base IS NOT NULL THEN NEW.code_base := upper(NEW.code_base); END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS suppliers_uppercase_trg ON public.suppliers;
CREATE TRIGGER suppliers_uppercase_trg
BEFORE INSERT OR UPDATE ON public.suppliers
FOR EACH ROW EXECUTE FUNCTION public.suppliers_uppercase_tg();

CREATE OR REPLACE FUNCTION public.shipments_uppercase_code_tg()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.code IS NOT NULL THEN NEW.code := upper(NEW.code); END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS shipments_uppercase_code_trg ON public.shipments;
CREATE TRIGGER shipments_uppercase_code_trg
BEFORE INSERT OR UPDATE ON public.shipments
FOR EACH ROW EXECUTE FUNCTION public.shipments_uppercase_code_tg();

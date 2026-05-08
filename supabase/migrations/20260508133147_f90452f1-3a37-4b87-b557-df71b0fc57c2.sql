
-- shipments: new fields
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS logistics_days integer,
  ADD COLUMN IF NOT EXISTS import_manager_id uuid,
  ADD COLUMN IF NOT EXISTS loading_date date;

-- shipment_items: new fields
ALTER TABLE public.shipment_items
  ADD COLUMN IF NOT EXISTS caliber text,
  ADD COLUMN IF NOT EXISTS pallet_count numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pallet_weight numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invoice_price numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS indicative_price numeric DEFAULT 0;

-- branches: ordering + seed
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0;

INSERT INTO public.branches (name, sort_order)
SELECT v.name, v.ord
FROM (VALUES
  ('Шувар',1),('Малехів',2),('Дніпро',3),('Хмель',4),('Вінниця',5),
  ('Київ',6),('КР',7),('Рівне',8),('Франк',9),('Дубово',10),
  ('Одеса',11),('Орбіта',12),('Харків',13),('АТБ',14)
) AS v(name, ord)
WHERE NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.name = v.name);

UPDATE public.branches b
SET sort_order = v.ord
FROM (VALUES
  ('Шувар',1),('Малехів',2),('Дніпро',3),('Хмель',4),('Вінниця',5),
  ('Київ',6),('КР',7),('Рівне',8),('Франк',9),('Дубово',10),
  ('Одеса',11),('Орбіта',12),('Харків',13),('АТБ',14)
) AS v(name, ord)
WHERE b.name = v.name;

-- distribution_items: pallets
ALTER TABLE public.distribution_items
  ADD COLUMN IF NOT EXISTS pallets numeric DEFAULT 0;

-- shipment_item_changes table
CREATE TABLE IF NOT EXISTS public.shipment_item_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_item_id uuid NOT NULL,
  shipment_id uuid NOT NULL,
  field text NOT NULL,
  old_value text,
  new_value text,
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shipment_item_changes_item_idx
  ON public.shipment_item_changes(shipment_item_id);
CREATE INDEX IF NOT EXISTS shipment_item_changes_shipment_idx
  ON public.shipment_item_changes(shipment_id);

ALTER TABLE public.shipment_item_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "item_changes staff all" ON public.shipment_item_changes
  FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "item_changes branch read" ON public.shipment_item_changes
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.distributions d
    WHERE d.shipment_id = shipment_item_changes.shipment_id
      AND d.branch_id = public.user_branch_id(auth.uid())
  ));

-- trigger to log changes on shipment_items
CREATE OR REPLACE FUNCTION public.log_shipment_item_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.qty IS DISTINCT FROM OLD.qty THEN
    INSERT INTO public.shipment_item_changes(shipment_item_id, shipment_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, NEW.shipment_id, 'qty', OLD.qty::text, NEW.qty::text, auth.uid());
  END IF;
  IF NEW.unit_price IS DISTINCT FROM OLD.unit_price THEN
    INSERT INTO public.shipment_item_changes(shipment_item_id, shipment_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, NEW.shipment_id, 'unit_price', OLD.unit_price::text, NEW.unit_price::text, auth.uid());
  END IF;
  IF NEW.caliber IS DISTINCT FROM OLD.caliber THEN
    INSERT INTO public.shipment_item_changes(shipment_item_id, shipment_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, NEW.shipment_id, 'caliber', OLD.caliber, NEW.caliber, auth.uid());
  END IF;
  IF NEW.pallet_count IS DISTINCT FROM OLD.pallet_count THEN
    INSERT INTO public.shipment_item_changes(shipment_item_id, shipment_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, NEW.shipment_id, 'pallet_count', OLD.pallet_count::text, NEW.pallet_count::text, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS shipment_items_log_changes ON public.shipment_items;
CREATE TRIGGER shipment_items_log_changes
AFTER UPDATE ON public.shipment_items
FOR EACH ROW EXECUTE FUNCTION public.log_shipment_item_changes();

-- trigger to log shipment eta changes
CREATE OR REPLACE FUNCTION public.log_shipment_eta_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.eta IS DISTINCT FROM OLD.eta THEN
    INSERT INTO public.shipment_item_changes(shipment_item_id, shipment_id, field, old_value, new_value, changed_by)
    SELECT si.id, NEW.id, 'eta', OLD.eta::text, NEW.eta::text, auth.uid()
    FROM public.shipment_items si WHERE si.shipment_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS shipments_log_eta ON public.shipments;
CREATE TRIGGER shipments_log_eta
AFTER UPDATE ON public.shipments
FOR EACH ROW EXECUTE FUNCTION public.log_shipment_eta_changes();


-- BRANCHES: code + is_active
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- helper: admin check
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('super_admin','admin')
  )
$$;

-- IMPORT MANAGERS
CREATE TABLE IF NOT EXISTS public.import_managers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  phone text,
  email text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.import_managers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "im read auth" ON public.import_managers FOR SELECT TO authenticated USING (true);
CREATE POLICY "im write admin" ON public.import_managers FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE TRIGGER touch_im BEFORE UPDATE ON public.import_managers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- SUPPLIERS: is_active + manager link
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS import_manager_id uuid REFERENCES public.import_managers(id) ON DELETE SET NULL;

-- PRODUCTS
CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text,
  default_pallet_weight numeric DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products read auth" ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY "products write admin" ON public.products FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE TRIGGER touch_products BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- COUNTRY LOGISTICS
CREATE TABLE IF NOT EXISTS public.country_logistics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country text NOT NULL UNIQUE,
  logistics_days integer NOT NULL DEFAULT 1,
  weekend_adjustment boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.country_logistics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cl read auth" ON public.country_logistics FOR SELECT TO authenticated USING (true);
CREATE POLICY "cl write admin" ON public.country_logistics FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE TRIGGER touch_cl BEFORE UPDATE ON public.country_logistics
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- SEED BRANCHES (14 fixed, by name match -> sort_order + code)
DO $$
DECLARE
  arr text[][] := ARRAY[
    ['Шувар','SHU','1'],['Малехів','MAL','2'],['Дніпро','DNI','3'],['Хмель','HML','4'],
    ['Вінниця','VIN','5'],['Київ','KYI','6'],['КР','KRO','7'],['Рівне','RIV','8'],
    ['Франк','FRA','9'],['Дубово','DUB','10'],['Одеса','ODE','11'],['Орбіта','ORB','12'],
    ['Харків','KHA','13'],['АТБ','ATB','14']
  ];
  r text[];
BEGIN
  FOREACH r SLICE 1 IN ARRAY arr LOOP
    INSERT INTO public.branches (name, code, sort_order, is_active)
    VALUES (r[1], r[2], r[3]::int, true)
    ON CONFLICT DO NOTHING;
    UPDATE public.branches SET code = r[2], sort_order = r[3]::int, is_active = true
    WHERE name = r[1];
  END LOOP;
END $$;

-- SEED IMPORT MANAGERS
INSERT INTO public.import_managers (full_name) VALUES
  ('Лукач Назарій'),('Сахарчук Оксана'),('Багамолов Ілля'),
  ('Сапіга Олександр'),('Калимон Наталія'),('Масолітіна Альона'),('Пазинич Павло')
ON CONFLICT DO NOTHING;

-- SEED COUNTRY LOGISTICS
INSERT INTO public.country_logistics (country, logistics_days, weekend_adjustment) VALUES
  ('Poland',1,true),('Moldova',1,true),('Italy',4,true),('Greece',4,true),
  ('Spain',6,true),('Netherlands',4,true),('Belgium',4,true),('Albania',3,true),('Macedonia',3,true)
ON CONFLICT (country) DO UPDATE SET
  logistics_days = EXCLUDED.logistics_days,
  weekend_adjustment = EXCLUDED.weekend_adjustment;

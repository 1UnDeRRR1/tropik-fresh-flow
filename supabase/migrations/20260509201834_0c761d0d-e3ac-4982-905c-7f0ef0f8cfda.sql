
CREATE TABLE public.manager_vacations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_manager_id UUID NOT NULL REFERENCES public.import_managers(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  mode TEXT NOT NULL DEFAULT 'full' CHECK (mode IN ('full','manual')),
  replacement_manager_id UUID REFERENCES public.import_managers(id) ON DELETE SET NULL,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

ALTER TABLE public.manager_vacations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vacations read staff" ON public.manager_vacations
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

CREATE POLICY "vacations write admin" ON public.manager_vacations
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE TRIGGER trg_manager_vacations_touch
  BEFORE UPDATE ON public.manager_vacations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX idx_manager_vacations_dates ON public.manager_vacations (import_manager_id, start_date, end_date);

CREATE TABLE public.vacation_supplier_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vacation_id UUID NOT NULL REFERENCES public.manager_vacations(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  temp_manager_id UUID NOT NULL REFERENCES public.import_managers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vacation_id, supplier_id)
);

ALTER TABLE public.vacation_supplier_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vsa read staff" ON public.vacation_supplier_assignments
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

CREATE POLICY "vsa write admin" ON public.vacation_supplier_assignments
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

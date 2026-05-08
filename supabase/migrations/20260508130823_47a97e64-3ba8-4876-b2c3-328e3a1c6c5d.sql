
-- Enums
CREATE TYPE public.app_role AS ENUM ('super_admin','admin','import_manager','branch');
CREATE TYPE public.shipment_status AS ENUM ('draft','in_transit','customs','arrived','distributing','completed','cancelled');
CREATE TYPE public.distribution_status AS ENUM ('planned','dispatched','received','cancelled');
CREATE TYPE public.transfer_status AS ENUM ('requested','approved','in_transit','received','cancelled');

-- Branches
CREATE TABLE public.branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  city TEXT,
  address TEXT,
  manager_name TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  phone TEXT,
  avatar_url TEXT,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User roles (separate table to avoid recursive RLS)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);

-- has_role security definer
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('super_admin','admin','import_manager')
  )
$$;

CREATE OR REPLACE FUNCTION public.user_branch_id(_user_id UUID)
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT branch_id FROM public.profiles WHERE id = _user_id
$$;

-- Suppliers
CREATE TABLE public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  country TEXT,
  contact TEXT,
  email TEXT,
  phone TEXT,
  rating SMALLINT DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Shipments
CREATE TABLE public.shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  status public.shipment_status NOT NULL DEFAULT 'draft',
  eta DATE,
  arrived_at DATE,
  total_weight_kg NUMERIC(12,2) DEFAULT 0,
  currency TEXT DEFAULT 'EUR',
  fx_rate NUMERIC(12,4) DEFAULT 1,
  customs_cost NUMERIC(12,2) DEFAULT 0,
  logistics_cost NUMERIC(12,2) DEFAULT 0,
  other_costs NUMERIC(12,2) DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.shipment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  sku TEXT,
  qty NUMERIC(12,2) NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'kg',
  unit_price NUMERIC(12,4) NOT NULL DEFAULT 0,
  weight_kg NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Distributions
CREATE TABLE public.distributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  status public.distribution_status NOT NULL DEFAULT 'planned',
  dispatched_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.distribution_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  distribution_id UUID NOT NULL REFERENCES public.distributions(id) ON DELETE CASCADE,
  shipment_item_id UUID NOT NULL REFERENCES public.shipment_items(id) ON DELETE CASCADE,
  qty NUMERIC(12,2) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(12,4) DEFAULT 0
);

-- Transfers
CREATE TABLE public.transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  to_branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  status public.transfer_status NOT NULL DEFAULT 'requested',
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.transfer_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES public.transfers(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  qty NUMERIC(12,2) NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'kg'
);

-- Notifications
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit logs
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger: auto profile + default role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'branch');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER profiles_updated BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER shipments_updated BEFORE UPDATE ON public.shipments
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Enable RLS
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.distributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.distribution_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfer_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Policies
-- branches: everyone authenticated reads; staff writes
CREATE POLICY "branches read auth" ON public.branches FOR SELECT TO authenticated USING (true);
CREATE POLICY "branches write staff" ON public.branches FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- profiles: own + staff sees all
CREATE POLICY "profiles read own or staff" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "profiles update own" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "profiles admin update all" ON public.profiles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (true);

-- user_roles: own read; super_admin manages
CREATE POLICY "roles read own or super" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "roles super manages" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'super_admin')) WITH CHECK (public.has_role(auth.uid(),'super_admin'));

-- suppliers: read all auth, write staff
CREATE POLICY "suppliers read" ON public.suppliers FOR SELECT TO authenticated USING (true);
CREATE POLICY "suppliers write staff" ON public.suppliers FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- shipments: staff full; branch reads only shipments distributed to them
CREATE POLICY "shipments staff all" ON public.shipments FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "shipments branch read distributed" ON public.shipments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.distributions d
    WHERE d.shipment_id = shipments.id AND d.branch_id = public.user_branch_id(auth.uid())
  ));

CREATE POLICY "shipment_items staff all" ON public.shipment_items FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "shipment_items branch read" ON public.shipment_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.distributions d
    WHERE d.shipment_id = shipment_items.shipment_id AND d.branch_id = public.user_branch_id(auth.uid())
  ));

-- distributions: staff full; branch reads/updates own
CREATE POLICY "distributions staff all" ON public.distributions FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "distributions branch read" ON public.distributions FOR SELECT TO authenticated
  USING (branch_id = public.user_branch_id(auth.uid()));
CREATE POLICY "distributions branch confirm" ON public.distributions FOR UPDATE TO authenticated
  USING (branch_id = public.user_branch_id(auth.uid())) WITH CHECK (branch_id = public.user_branch_id(auth.uid()));

CREATE POLICY "distribution_items staff all" ON public.distribution_items FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "distribution_items branch read" ON public.distribution_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.distributions d WHERE d.id = distribution_items.distribution_id AND d.branch_id = public.user_branch_id(auth.uid())));

-- transfers: staff all; branch sees own from/to
CREATE POLICY "transfers staff all" ON public.transfers FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "transfers branch read" ON public.transfers FOR SELECT TO authenticated
  USING (from_branch_id = public.user_branch_id(auth.uid()) OR to_branch_id = public.user_branch_id(auth.uid()));
CREATE POLICY "transfers branch insert" ON public.transfers FOR INSERT TO authenticated
  WITH CHECK (from_branch_id = public.user_branch_id(auth.uid()) OR to_branch_id = public.user_branch_id(auth.uid()));

CREATE POLICY "transfer_items staff all" ON public.transfer_items FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "transfer_items branch read" ON public.transfer_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.transfers t WHERE t.id = transfer_items.transfer_id AND (t.from_branch_id = public.user_branch_id(auth.uid()) OR t.to_branch_id = public.user_branch_id(auth.uid()))));
CREATE POLICY "transfer_items branch insert" ON public.transfer_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.transfers t WHERE t.id = transfer_items.transfer_id AND (t.from_branch_id = public.user_branch_id(auth.uid()) OR t.to_branch_id = public.user_branch_id(auth.uid()))));

-- notifications: own only
CREATE POLICY "notifications own read" ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "notifications own update" ON public.notifications FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "notifications staff insert" ON public.notifications FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));

-- audit_logs: super_admin read; staff insert
CREATE POLICY "audit super read" ON public.audit_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "audit staff insert" ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()));

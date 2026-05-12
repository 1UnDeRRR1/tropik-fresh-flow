-- calendar_accounts table
CREATE TABLE IF NOT EXISTS public.calendar_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  username text NOT NULL UNIQUE,
  access_type text NOT NULL CHECK (access_type IN ('branch','tropik')),
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  valid_from date NOT NULL DEFAULT CURRENT_DATE,
  valid_until date,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_accounts_branch_required
    CHECK (access_type <> 'branch' OR branch_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS calendar_accounts_user_id_key
  ON public.calendar_accounts(user_id);

DROP TRIGGER IF EXISTS calendar_accounts_touch ON public.calendar_accounts;
CREATE TRIGGER calendar_accounts_touch
BEFORE UPDATE ON public.calendar_accounts
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.calendar_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "calendar_accounts admin all" ON public.calendar_accounts;
CREATE POLICY "calendar_accounts admin all"
ON public.calendar_accounts
FOR ALL TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "calendar_accounts read own" ON public.calendar_accounts;
CREATE POLICY "calendar_accounts read own"
ON public.calendar_accounts
FOR SELECT TO authenticated
USING (user_id = auth.uid());

-- Helpers
CREATE OR REPLACE FUNCTION public.is_calendar_active(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.calendar_accounts ca
    WHERE ca.user_id = _user_id
      AND ca.is_active = true
      AND ca.valid_from <= CURRENT_DATE
      AND (ca.valid_until IS NULL OR ca.valid_until >= CURRENT_DATE)
  );
$$;

CREATE OR REPLACE FUNCTION public.user_calendar_branch(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT branch_id FROM public.calendar_accounts
   WHERE user_id = _user_id AND access_type = 'branch'
   LIMIT 1;
$$;

-- Read access for calendar_branch
DROP POLICY IF EXISTS "distributions calendar_branch read" ON public.distributions;
CREATE POLICY "distributions calendar_branch read"
ON public.distributions
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'calendar_branch')
  AND public.is_calendar_active(auth.uid())
  AND branch_id = public.user_calendar_branch(auth.uid())
);

DROP POLICY IF EXISTS "distribution_items calendar_branch read" ON public.distribution_items;
CREATE POLICY "distribution_items calendar_branch read"
ON public.distribution_items
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'calendar_branch')
  AND public.is_calendar_active(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.distributions d
    WHERE d.id = distribution_items.distribution_id
      AND d.branch_id = public.user_calendar_branch(auth.uid())
  )
);

-- Tropik calendar RPCs
CREATE OR REPLACE FUNCTION public.tropik_calendar_aggregate()
RETURNS TABLE(product_name text, total_pallets numeric, shipment_count integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT si.product_name,
         SUM(COALESCE(si.pallet_count,0))::numeric AS total_pallets,
         COUNT(DISTINCT s.id)::int AS shipment_count
    FROM public.shipments s
    JOIN public.shipment_items si ON si.shipment_id = s.id
   WHERE (
           public.is_staff(auth.uid())
           OR (public.has_role(auth.uid(), 'calendar_tropik')
               AND public.is_calendar_active(auth.uid()))
         )
     AND s.status NOT IN ('cancelled','completed')
     AND COALESCE(si.pallet_count,0) > 0
   GROUP BY si.product_name
   ORDER BY total_pallets DESC;
$$;

CREATE OR REPLACE FUNCTION public.tropik_calendar_shipments(_product text)
RETURNS TABLE(
  shipment_id uuid,
  shipment_code text,
  status text,
  eta date,
  pallets numeric,
  caliber text,
  origin_country text,
  manager_name text,
  final_cost_indicative numeric,
  final_cost_invoice numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id,
         s.code,
         s.status::text,
         s.eta,
         COALESCE(si.pallet_count,0),
         si.caliber,
         COALESCE(si.origin_country, s.country),
         COALESCE(p.full_name, im.full_name, 'Менеджер'),
         COALESCE(si.final_cost_indicative, 0),
         COALESCE(si.final_cost_invoice, 0)
    FROM public.shipments s
    JOIN public.shipment_items si ON si.shipment_id = s.id
    LEFT JOIN public.profiles p ON p.id = s.import_manager_id
    LEFT JOIN public.import_managers im ON im.user_id = s.import_manager_id
   WHERE (
           public.is_staff(auth.uid())
           OR (public.has_role(auth.uid(), 'calendar_tropik')
               AND public.is_calendar_active(auth.uid()))
         )
     AND s.status NOT IN ('cancelled','completed')
     AND COALESCE(si.pallet_count,0) > 0
     AND lower(btrim(si.product_name)) = lower(btrim(_product))
   ORDER BY s.eta NULLS LAST, s.code;
$$;

CREATE OR REPLACE FUNCTION public.next_calendar_username_seq(_prefix text)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(MAX(
    CASE WHEN username ~ ('^' || _prefix || '-([0-9]+)$')
      THEN NULLIF(regexp_replace(username, '^' || _prefix || '-', ''), '')::int
      ELSE 0 END
  ), 0) + 1
  FROM public.calendar_accounts;
$$;
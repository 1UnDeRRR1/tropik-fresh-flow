
-- Enums
CREATE TYPE public.manager_offer_status AS ENUM (
  'draft','active','in_work','confirmed','linked','closed','expired','deleted'
);

-- manager_offers
CREATE TABLE public.manager_offers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_by uuid NOT NULL,
  import_manager_id uuid,
  product_name text NOT NULL,
  origin_country text,
  caliber text,
  packaging text,
  specification text,
  variety text,
  indicative_cost_usd numeric DEFAULT 0,
  invoice_cost_usd numeric DEFAULT 0,
  prev_indicative_cost_usd numeric,
  prev_invoice_cost_usd numeric,
  offered_pallets numeric,
  expires_at timestamptz,
  status public.manager_offer_status NOT NULL DEFAULT 'draft',
  linked_shipment_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.manager_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manager_offers admin all" ON public.manager_offers
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "manager_offers owner all" ON public.manager_offers
  FOR ALL TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- Branch can read offers visible to them (active/in_work/confirmed/linked)
CREATE POLICY "manager_offers branch read" ON public.manager_offers
  FOR SELECT TO authenticated
  USING (status IN ('active','in_work','confirmed','linked'));

-- Staff can read all
CREATE POLICY "manager_offers staff read" ON public.manager_offers
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE TRIGGER manager_offers_touch
BEFORE UPDATE ON public.manager_offers
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- responses
CREATE TABLE public.manager_offer_responses (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  offer_id uuid NOT NULL REFERENCES public.manager_offers(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL,
  requested_pallets numeric NOT NULL DEFAULT 0,
  approved_pallets numeric,
  prev_approved_pallets numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (offer_id, branch_id)
);

ALTER TABLE public.manager_offer_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mor admin all" ON public.manager_offer_responses
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- branch can manage own response on visible offer
CREATE POLICY "mor branch read own" ON public.manager_offer_responses
  FOR SELECT TO authenticated
  USING (branch_id = public.user_branch_id(auth.uid()));

CREATE POLICY "mor branch insert own" ON public.manager_offer_responses
  FOR INSERT TO authenticated
  WITH CHECK (
    branch_id = public.user_branch_id(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.manager_offers o
      WHERE o.id = offer_id AND o.status IN ('active','in_work','confirmed')
    )
  );

CREATE POLICY "mor branch update own" ON public.manager_offer_responses
  FOR UPDATE TO authenticated
  USING (branch_id = public.user_branch_id(auth.uid()))
  WITH CHECK (branch_id = public.user_branch_id(auth.uid()));

CREATE POLICY "mor branch delete own" ON public.manager_offer_responses
  FOR DELETE TO authenticated
  USING (
    branch_id = public.user_branch_id(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.manager_offers o
      WHERE o.id = offer_id AND o.status = 'active'
    )
  );

-- offer owner sees and manages all responses to own offers
CREATE POLICY "mor owner all" ON public.manager_offer_responses
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.manager_offers o
    WHERE o.id = offer_id AND o.created_by = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.manager_offers o
    WHERE o.id = offer_id AND o.created_by = auth.uid()
  ));

CREATE TRIGGER mor_touch
BEFORE UPDATE ON public.manager_offer_responses
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- track previous values for cost/approved_pallets to enable diff highlight
CREATE OR REPLACE FUNCTION public.track_manager_offer_prev_costs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.indicative_cost_usd IS DISTINCT FROM OLD.indicative_cost_usd THEN
      NEW.prev_indicative_cost_usd := OLD.indicative_cost_usd;
    END IF;
    IF NEW.invoice_cost_usd IS DISTINCT FROM OLD.invoice_cost_usd THEN
      NEW.prev_invoice_cost_usd := OLD.invoice_cost_usd;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER manager_offers_track_prev_costs
BEFORE UPDATE ON public.manager_offers
FOR EACH ROW EXECUTE FUNCTION public.track_manager_offer_prev_costs();

CREATE OR REPLACE FUNCTION public.track_mor_prev_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.approved_pallets IS DISTINCT FROM OLD.approved_pallets THEN
    NEW.prev_approved_pallets := OLD.approved_pallets;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mor_track_prev_approved
BEFORE UPDATE ON public.manager_offer_responses
FOR EACH ROW EXECUTE FUNCTION public.track_mor_prev_approved();

-- Expire timer
CREATE OR REPLACE FUNCTION public.expire_manager_offers()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE n integer;
BEGIN
  WITH upd AS (
    UPDATE public.manager_offers
       SET status = 'expired'
     WHERE status IN ('active','in_work','confirmed')
       AND expires_at IS NOT NULL
       AND expires_at < now()
     RETURNING id
  ) SELECT count(*) INTO n FROM upd;
  RETURN n;
END;
$$;

-- shipment_items.linked_offer_id
ALTER TABLE public.shipment_items
  ADD COLUMN linked_offer_id uuid REFERENCES public.manager_offers(id) ON DELETE SET NULL;

-- Auto-distribute on offer link
CREATE OR REPLACE FUNCTION public.apply_manager_offer_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  resp record;
  ship_id uuid;
  match_item_id uuid;
  unit_cost_value numeric;
  dist_id uuid;
BEGIN
  IF NEW.status = 'linked' AND NEW.linked_shipment_id IS NOT NULL
     AND (OLD.status IS DISTINCT FROM 'linked' OR OLD.linked_shipment_id IS DISTINCT FROM NEW.linked_shipment_id) THEN

    ship_id := NEW.linked_shipment_id;

    -- find matching shipment item
    SELECT si.id, COALESCE(si.unit_price_usd, 0)
      INTO match_item_id, unit_cost_value
      FROM public.shipment_items si
     WHERE si.shipment_id = ship_id
       AND lower(btrim(si.product_name)) = lower(btrim(NEW.product_name))
       AND COALESCE(lower(btrim(si.origin_country)),'') = COALESCE(lower(btrim(NEW.origin_country)),'')
       AND COALESCE(lower(btrim(si.caliber)),'') = COALESCE(lower(btrim(NEW.caliber)),'')
       AND COALESCE(lower(btrim(si.variety)),'') = COALESCE(lower(btrim(NEW.variety)),'')
     ORDER BY si.linked_offer_id = NEW.id DESC NULLS LAST
     LIMIT 1;

    IF match_item_id IS NULL THEN
      RETURN NEW;
    END IF;

    -- ensure shipment_item is linked to this offer
    UPDATE public.shipment_items SET linked_offer_id = NEW.id WHERE id = match_item_id AND linked_offer_id IS NULL;

    FOR resp IN
      SELECT * FROM public.manager_offer_responses
       WHERE offer_id = NEW.id
         AND COALESCE(approved_pallets, 0) > 0
    LOOP
      SELECT id INTO dist_id FROM public.distributions
       WHERE shipment_id = ship_id AND branch_id = resp.branch_id LIMIT 1;
      IF dist_id IS NULL THEN
        INSERT INTO public.distributions(shipment_id, branch_id, status, notes)
        VALUES (ship_id, resp.branch_id, 'planned', 'Авторозподіл за пропозицією')
        RETURNING id INTO dist_id;
      END IF;

      INSERT INTO public.distribution_items(distribution_id, shipment_item_id, pallets, qty, unit_cost)
      VALUES (dist_id, match_item_id, resp.approved_pallets, 0, COALESCE(unit_cost_value, 0))
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER manager_offers_apply_link
AFTER UPDATE ON public.manager_offers
FOR EACH ROW EXECUTE FUNCTION public.apply_manager_offer_link();

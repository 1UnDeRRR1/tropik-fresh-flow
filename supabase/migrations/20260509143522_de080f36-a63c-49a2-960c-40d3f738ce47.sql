
CREATE TYPE public.branch_offer_status AS ENUM ('pending','partially_accepted','accepted','rejected','expired');

CREATE TABLE public.branch_transfer_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_item_id uuid NOT NULL,
  distribution_id uuid NOT NULL,
  from_branch_id uuid NOT NULL,
  to_branch_id uuid NOT NULL,
  offered_pallets numeric NOT NULL CHECK (offered_pallets > 0),
  accepted_pallets numeric NOT NULL DEFAULT 0 CHECK (accepted_pallets >= 0),
  status public.branch_offer_status NOT NULL DEFAULT 'pending',
  notes text,
  decision_notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CHECK (from_branch_id <> to_branch_id),
  CHECK (accepted_pallets <= offered_pallets)
);

CREATE INDEX idx_bto_from ON public.branch_transfer_offers(from_branch_id);
CREATE INDEX idx_bto_to ON public.branch_transfer_offers(to_branch_id);
CREATE INDEX idx_bto_item ON public.branch_transfer_offers(shipment_item_id);
CREATE INDEX idx_bto_status ON public.branch_transfer_offers(status);

ALTER TABLE public.branch_transfer_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bto staff all" ON public.branch_transfer_offers
  FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "bto branch read" ON public.branch_transfer_offers
  FOR SELECT TO authenticated
  USING (from_branch_id = public.user_branch_id(auth.uid()) OR to_branch_id = public.user_branch_id(auth.uid()));

CREATE POLICY "bto source insert" ON public.branch_transfer_offers
  FOR INSERT TO authenticated
  WITH CHECK (from_branch_id = public.user_branch_id(auth.uid()));

CREATE POLICY "bto target update" ON public.branch_transfer_offers
  FOR UPDATE TO authenticated
  USING (to_branch_id = public.user_branch_id(auth.uid()))
  WITH CHECK (to_branch_id = public.user_branch_id(auth.uid()));

CREATE POLICY "bto source cancel" ON public.branch_transfer_offers
  FOR UPDATE TO authenticated
  USING (from_branch_id = public.user_branch_id(auth.uid()))
  WITH CHECK (from_branch_id = public.user_branch_id(auth.uid()));

CREATE OR REPLACE FUNCTION public.touch_branch_transfer_offers()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_bto_touch
BEFORE UPDATE ON public.branch_transfer_offers
FOR EACH ROW EXECUTE FUNCTION public.touch_branch_transfer_offers();

CREATE OR REPLACE FUNCTION public.validate_branch_transfer_offer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  src_pallets numeric := 0;
  used_pallets numeric := 0;
  ship_eta date;
BEGIN
  -- Check ETA window for acceptance/partial acceptance
  IF (TG_OP = 'UPDATE') AND NEW.status IN ('accepted','partially_accepted')
     AND OLD.status = 'pending' THEN
    SELECT s.eta INTO ship_eta
    FROM public.shipment_items si
    JOIN public.shipments s ON s.id = si.shipment_id
    WHERE si.id = NEW.shipment_item_id;
    IF ship_eta IS NOT NULL AND ship_eta - CURRENT_DATE <= 1 THEN
      RAISE EXCEPTION 'Пропозиція протермінована (менше 24 годин до прибуття)';
    END IF;
  END IF;

  -- Prevent over-acceptance
  IF NEW.accepted_pallets > 0 AND
     (TG_OP = 'INSERT' OR NEW.accepted_pallets IS DISTINCT FROM OLD.accepted_pallets) THEN
    SELECT COALESCE(SUM(di.pallets),0) INTO src_pallets
      FROM public.distribution_items di
      JOIN public.distributions d ON d.id = di.distribution_id
      WHERE di.shipment_item_id = NEW.shipment_item_id
        AND d.branch_id = NEW.from_branch_id;

    SELECT COALESCE(SUM(o.accepted_pallets),0) INTO used_pallets
      FROM public.branch_transfer_offers o
      WHERE o.from_branch_id = NEW.from_branch_id
        AND o.shipment_item_id = NEW.shipment_item_id
        AND o.id <> NEW.id
        AND o.accepted_pallets > 0;

    IF used_pallets + NEW.accepted_pallets > src_pallets THEN
      RAISE EXCEPTION 'Недостатньо палет у філії-джерела (% доступно, % вже використано)', src_pallets, used_pallets;
    END IF;
  END IF;

  RETURN NEW;
END; $$;

CREATE TRIGGER trg_bto_validate
BEFORE INSERT OR UPDATE ON public.branch_transfer_offers
FOR EACH ROW EXECUTE FUNCTION public.validate_branch_transfer_offer();

-- Function to expire pending offers (lazy: callable from app or cron)
CREATE OR REPLACE FUNCTION public.expire_branch_transfer_offers()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n integer;
BEGIN
  WITH upd AS (
    UPDATE public.branch_transfer_offers o
       SET status = 'expired', decided_at = now()
      FROM public.shipment_items si
      JOIN public.shipments s ON s.id = si.shipment_id
     WHERE o.shipment_item_id = si.id
       AND o.status = 'pending'
       AND s.eta IS NOT NULL
       AND s.eta - CURRENT_DATE <= 1
     RETURNING o.id
  ) SELECT count(*) INTO n FROM upd;
  RETURN n;
END; $$;

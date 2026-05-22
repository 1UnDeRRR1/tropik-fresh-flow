
-- =========================================================================
-- Patch 8A: branch-visible price layer
-- =========================================================================

-- 1) shipments.final_freight_locked_at -------------------------------------
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS final_freight_locked_at timestamptz;

-- 2) branch_visible_prices table -------------------------------------------
CREATE TABLE IF NOT EXISTS public.branch_visible_prices (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  distribution_id       uuid NOT NULL REFERENCES public.distributions(id)    ON DELETE CASCADE,
  shipment_item_id      uuid NOT NULL REFERENCES public.shipment_items(id)   ON DELETE CASCADE,
  branch_id             uuid NOT NULL REFERENCES public.branches(id)         ON DELETE CASCADE,
  cost_indicative_usd   numeric NOT NULL,
  cost_invoice_usd      numeric NOT NULL,
  reason                text    NOT NULL
    CHECK (reason IN ('initial','final_freight_locked','unit_price_increased')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT branch_visible_prices_unique_key
    UNIQUE (distribution_id, shipment_item_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_bvp_branch          ON public.branch_visible_prices(branch_id);
CREATE INDEX IF NOT EXISTS idx_bvp_shipment_item   ON public.branch_visible_prices(shipment_item_id);
CREATE INDEX IF NOT EXISTS idx_bvp_distribution    ON public.branch_visible_prices(distribution_id);

ALTER TABLE public.branch_visible_prices ENABLE ROW LEVEL SECURITY;

-- Grants: SELECT only to authenticated; no INSERT/UPDATE/DELETE.
REVOKE ALL ON public.branch_visible_prices FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.branch_visible_prices TO authenticated;

-- RLS policies
DROP POLICY IF EXISTS "bvp staff read"  ON public.branch_visible_prices;
DROP POLICY IF EXISTS "bvp branch read" ON public.branch_visible_prices;

CREATE POLICY "bvp staff read"
  ON public.branch_visible_prices
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE POLICY "bvp branch read"
  ON public.branch_visible_prices
  FOR SELECT TO authenticated
  USING (branch_id = public.user_branch_id(auth.uid()));

-- 3) Internal helpers ------------------------------------------------------

-- _bvp_link(distribution_id, shipment_item_id, branch_id) -> stable URL
CREATE OR REPLACE FUNCTION public._bvp_link(
  p_distribution_id  uuid,
  p_shipment_item_id uuid,
  p_branch_id        uuid
) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT '/dashboard/branch?distribution_id=' || p_distribution_id::text
      || '&shipment_item_id=' || p_shipment_item_id::text
      || '&branch_id=' || p_branch_id::text;
$$;

-- _bvp_propagate_shipment
-- Refreshes branch_visible_prices for one shipment, optionally scoped to a
-- single shipment_item. Inserts a per-branch notification only when an
-- existing BVP row's cost actually changes. Missing rows are seeded silently
-- with reason='initial' and produce no notification.
CREATE OR REPLACE FUNCTION public._bvp_propagate_shipment(
  p_shipment_id      uuid,
  p_reason           text,
  p_shipment_item_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r            record;
  v_existed    boolean;
  v_old_ind    numeric;
  v_old_inv    numeric;
  v_new_ind    numeric;
  v_new_inv    numeric;
  v_changed    boolean;
  v_link       text;
  v_title      text;
  v_body       text;
BEGIN
  IF p_reason NOT IN ('final_freight_locked','unit_price_increased') THEN
    RAISE EXCEPTION 'Invalid _bvp_propagate_shipment reason: %', p_reason;
  END IF;

  FOR r IN
    SELECT
      d.id            AS distribution_id,
      d.branch_id     AS branch_id,
      di.shipment_item_id,
      si.final_cost_indicative AS new_ind,
      si.final_cost_invoice    AS new_inv,
      si.product_name,
      si.unit_price_usd
    FROM public.distribution_items di
    JOIN public.distributions d  ON d.id  = di.distribution_id
    JOIN public.shipment_items si ON si.id = di.shipment_item_id
    WHERE d.shipment_id = p_shipment_id
      AND (p_shipment_item_id IS NULL OR di.shipment_item_id = p_shipment_item_id)
  LOOP
    v_new_ind := COALESCE(r.new_ind, 0);
    v_new_inv := COALESCE(r.new_inv, 0);

    SELECT TRUE, cost_indicative_usd, cost_invoice_usd
      INTO v_existed, v_old_ind, v_old_inv
      FROM public.branch_visible_prices
      WHERE distribution_id  = r.distribution_id
        AND shipment_item_id = r.shipment_item_id
        AND branch_id        = r.branch_id;

    IF NOT FOUND THEN
      v_existed := FALSE;
    END IF;

    IF NOT v_existed THEN
      -- Silent seed: missing row recovery, no notification.
      INSERT INTO public.branch_visible_prices(
        distribution_id, shipment_item_id, branch_id,
        cost_indicative_usd, cost_invoice_usd, reason, updated_at
      ) VALUES (
        r.distribution_id, r.shipment_item_id, r.branch_id,
        v_new_ind, v_new_inv, 'initial', now()
      )
      ON CONFLICT (distribution_id, shipment_item_id, branch_id) DO NOTHING;
      CONTINUE;
    END IF;

    v_changed := (v_old_ind IS DISTINCT FROM v_new_ind)
              OR (v_old_inv IS DISTINCT FROM v_new_inv);

    IF NOT v_changed THEN
      CONTINUE;
    END IF;

    -- For unit_price_increased: propagate only if indicative actually increased.
    IF p_reason = 'unit_price_increased' AND v_new_ind <= COALESCE(v_old_ind, 0) THEN
      CONTINUE;
    END IF;

    UPDATE public.branch_visible_prices
      SET cost_indicative_usd = v_new_ind,
          cost_invoice_usd    = v_new_inv,
          reason              = p_reason,
          updated_at          = now()
      WHERE distribution_id  = r.distribution_id
        AND shipment_item_id = r.shipment_item_id
        AND branch_id        = r.branch_id;

    v_link  := public._bvp_link(r.distribution_id, r.shipment_item_id, r.branch_id);
    v_title := 'Оновлено ціну для філії';
    v_body  := r.product_name
            || ' · Інд: $' || to_char(COALESCE(v_old_ind,0), 'FM999990.00')
            || ' → $'      || to_char(v_new_ind,            'FM999990.00')
            || ' · Інв: $' || to_char(COALESCE(v_old_inv,0), 'FM999990.00')
            || ' → $'      || to_char(v_new_inv,            'FM999990.00')
            || ' · Причина: '
            || CASE p_reason
                 WHEN 'final_freight_locked'   THEN 'фінальний фрахт'
                 WHEN 'unit_price_increased'   THEN 'зміна ціни постачальника'
                 ELSE p_reason
               END;

    -- One notification per active user of that branch.
    INSERT INTO public.notifications(user_id, type, title, body, link)
    SELECT p.id, 'price_change', v_title, v_body, v_link
      FROM public.profiles p
     WHERE p.branch_id = r.branch_id
       AND p.is_active = TRUE;
  END LOOP;
END;
$$;

-- trg_bvp_unit_price_increase: trigger function — propagates only the
-- changed shipment_item to its branches.
CREATE OR REPLACE FUNCTION public.trg_bvp_unit_price_increase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.unit_price_usd, 0) <= COALESCE(OLD.unit_price_usd, 0) THEN
    RETURN NEW;
  END IF;
  PERFORM public._bvp_propagate_shipment(
    NEW.shipment_id,
    'unit_price_increased',
    NEW.id
  );
  RETURN NEW;
END;
$$;

-- trg_bvp_seed_on_distribution_item: silently seed a BVP row on new allocation.
CREATE OR REPLACE FUNCTION public.trg_bvp_seed_on_distribution_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch uuid;
  v_ind    numeric;
  v_inv    numeric;
BEGIN
  SELECT d.branch_id INTO v_branch
    FROM public.distributions d WHERE d.id = NEW.distribution_id;
  IF v_branch IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(si.final_cost_indicative, 0),
         COALESCE(si.final_cost_invoice,    0)
    INTO v_ind, v_inv
    FROM public.shipment_items si
    WHERE si.id = NEW.shipment_item_id;

  INSERT INTO public.branch_visible_prices(
    distribution_id, shipment_item_id, branch_id,
    cost_indicative_usd, cost_invoice_usd, reason, updated_at
  ) VALUES (
    NEW.distribution_id, NEW.shipment_item_id, v_branch,
    COALESCE(v_ind, 0), COALESCE(v_inv, 0), 'initial', now()
  )
  ON CONFLICT (distribution_id, shipment_item_id, branch_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Helper EXECUTE grants: revoke from PUBLIC/anon/authenticated.
REVOKE ALL ON FUNCTION public._bvp_link(uuid, uuid, uuid)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bvp_propagate_shipment(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_bvp_unit_price_increase()             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_bvp_seed_on_distribution_item()       FROM PUBLIC, anon, authenticated;

-- 4) Triggers --------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_90_bvp_unit_price_increase ON public.shipment_items;
CREATE TRIGGER trg_90_bvp_unit_price_increase
AFTER UPDATE ON public.shipment_items
FOR EACH ROW
WHEN (NEW.unit_price_usd IS DISTINCT FROM OLD.unit_price_usd)
EXECUTE FUNCTION public.trg_bvp_unit_price_increase();

DROP TRIGGER IF EXISTS trg_90_bvp_seed_on_distribution_item ON public.distribution_items;
CREATE TRIGGER trg_90_bvp_seed_on_distribution_item
AFTER INSERT ON public.distribution_items
FOR EACH ROW
EXECUTE FUNCTION public.trg_bvp_seed_on_distribution_item();

-- 5) lock_final_freight RPC ------------------------------------------------
CREATE OR REPLACE FUNCTION public.lock_final_freight(
  p_shipment_id uuid,
  p_amount      numeric,
  p_currency    text,
  p_payment     text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_fx      numeric;
  v_usd     numeric;
BEGIN
  -- Auth guard
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NOT (
       public.is_admin(v_uid)
    OR public.has_role(v_uid, 'logistics'::app_role)
    OR public.is_shipment_owner(p_shipment_id, v_uid)
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  -- Validation
  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'Invalid freight amount';
  END IF;
  IF p_currency IS NULL OR p_currency NOT IN ('EUR','USD') THEN
    RAISE EXCEPTION 'Invalid freight currency: %', p_currency;
  END IF;
  IF p_payment IS NOT NULL AND p_payment NOT IN ('cash','bank') THEN
    RAISE EXCEPTION 'Invalid payment type: %', p_payment;
  END IF;

  -- Resolve EUR->USD when currency is EUR using shipment's stored rate.
  IF p_currency = 'EUR' THEN
    SELECT eur_usd_rate INTO v_fx FROM public.shipments WHERE id = p_shipment_id;
    IF v_fx IS NULL OR v_fx = 0 THEN
      RAISE EXCEPTION 'EUR FX rate is missing for shipment %', p_shipment_id;
    END IF;
  END IF;

  -- Update shipments. Do NOT set logistics_cost_usd directly: the existing
  -- BEFORE trigger trg_01_shipment_logistics_usd handles that, and the AFTER
  -- trigger trg_02_recompute_items_costs then refreshes shipment_items
  -- final_cost_* before BVP propagation below.
  UPDATE public.shipments
     SET final_freight_amount    = p_amount,
         final_freight_currency  = p_currency,
         final_freight_payment   = COALESCE(p_payment, final_freight_payment),
         logistics_cost          = p_amount,
         logistics_cost_currency = p_currency,
         final_freight_locked_at = now()
   WHERE id = p_shipment_id;

  -- Propagate to branch-visible prices for the whole shipment.
  PERFORM public._bvp_propagate_shipment(p_shipment_id, 'final_freight_locked', NULL);
END;
$$;

REVOKE ALL  ON FUNCTION public.lock_final_freight(uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lock_final_freight(uuid, numeric, text, text) TO authenticated;

-- 6) branch_ack_changes replacement ---------------------------------------
-- Reads cost from branch_visible_prices, falls back to
-- branch_distribution_baselines.baseline_cost_*. Never reads
-- shipment_items.final_cost_*. Marks matching price_change notifications read
-- by exact link match.
CREATE OR REPLACE FUNCTION public.branch_ack_changes(
  p_distribution_id  uuid,
  p_shipment_item_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch  uuid;
  v_eta     date;
  v_pallets numeric;
  v_ind     numeric;
  v_inv     numeric;
  v_link    text;
BEGIN
  v_branch := public.user_branch_id(auth.uid());
  IF v_branch IS NULL THEN RETURN; END IF;

  SELECT s.eta INTO v_eta
    FROM public.distributions d
    JOIN public.shipments s ON s.id = d.shipment_id
    WHERE d.id = p_distribution_id;

  SELECT COALESCE(di.pallets, 0) INTO v_pallets
    FROM public.distribution_items di
    WHERE di.distribution_id = p_distribution_id
      AND di.shipment_item_id = p_shipment_item_id
    LIMIT 1;

  -- Branch-visible prices: prefer BVP, fall back to baseline.
  SELECT bvp.cost_indicative_usd, bvp.cost_invoice_usd
    INTO v_ind, v_inv
    FROM public.branch_visible_prices bvp
    WHERE bvp.distribution_id  = p_distribution_id
      AND bvp.shipment_item_id = p_shipment_item_id
      AND bvp.branch_id        = v_branch;

  IF v_ind IS NULL AND v_inv IS NULL THEN
    SELECT bdb.baseline_cost_ind, bdb.baseline_cost_inv
      INTO v_ind, v_inv
      FROM public.branch_distribution_baselines bdb
      WHERE bdb.distribution_id  = p_distribution_id
        AND bdb.shipment_item_id = p_shipment_item_id
        AND bdb.branch_id        = v_branch;
  END IF;

  UPDATE public.branch_distribution_baselines
    SET seen_eta      = v_eta,
        seen_pallets  = v_pallets,
        seen_cost_ind = v_ind,
        seen_cost_inv = v_inv,
        updated_at    = now()
    WHERE branch_id        = v_branch
      AND distribution_id  = p_distribution_id
      AND shipment_item_id = p_shipment_item_id;

  -- Mark related price_change notifications as read (exact link match).
  v_link := public._bvp_link(p_distribution_id, p_shipment_item_id, v_branch);
  UPDATE public.notifications
    SET read_at = now()
    WHERE user_id = auth.uid()
      AND type    = 'price_change'
      AND link    = v_link
      AND read_at IS NULL;
END;
$$;

-- 7) Backfill: idempotent, reason='initial', no notifications -------------
INSERT INTO public.branch_visible_prices(
  distribution_id, shipment_item_id, branch_id,
  cost_indicative_usd, cost_invoice_usd, reason, updated_at
)
SELECT DISTINCT
  d.id,
  di.shipment_item_id,
  d.branch_id,
  COALESCE(si.final_cost_indicative, 0),
  COALESCE(si.final_cost_invoice,    0),
  'initial',
  now()
FROM public.distribution_items di
JOIN public.distributions  d  ON d.id  = di.distribution_id
JOIN public.shipment_items si ON si.id = di.shipment_item_id
ON CONFLICT (distribution_id, shipment_item_id, branch_id) DO NOTHING;

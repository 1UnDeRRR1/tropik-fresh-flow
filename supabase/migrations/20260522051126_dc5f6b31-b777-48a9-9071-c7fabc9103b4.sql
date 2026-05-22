
-- ============================================================
-- Patch 6A v2: Manual customs override (митний збір)
-- ============================================================

-- 1) Columns on manager_offers
ALTER TABLE public.manager_offers
  ADD COLUMN IF NOT EXISTS customs_override_duty_usd numeric(12,4),
  ADD COLUMN IF NOT EXISTS customs_override_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS customs_override_by uuid;

-- 2) Columns on shipment_items
ALTER TABLE public.shipment_items
  ADD COLUMN IF NOT EXISTS customs_override_duty_usd numeric(12,4),
  ADD COLUMN IF NOT EXISTS customs_override_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS customs_override_by uuid;

-- 3) CHECK constraints
ALTER TABLE public.manager_offers
  DROP CONSTRAINT IF EXISTS mo_customs_override_duty_positive,
  DROP CONSTRAINT IF EXISTS mo_customs_override_metadata_pair,
  DROP CONSTRAINT IF EXISTS mo_active_requires_confirmed_override;

ALTER TABLE public.manager_offers
  ADD CONSTRAINT mo_customs_override_duty_positive
    CHECK (customs_override_duty_usd IS NULL OR customs_override_duty_usd > 0),
  ADD CONSTRAINT mo_customs_override_metadata_pair
    CHECK ((customs_override_confirmed_at IS NULL) = (customs_override_by IS NULL)),
  ADD CONSTRAINT mo_active_requires_confirmed_override
    CHECK (NOT (status = 'active'
                AND customs_override_duty_usd IS NOT NULL
                AND customs_override_confirmed_at IS NULL));

ALTER TABLE public.shipment_items
  DROP CONSTRAINT IF EXISTS si_customs_override_duty_positive,
  DROP CONSTRAINT IF EXISTS si_customs_override_metadata_pair;

ALTER TABLE public.shipment_items
  ADD CONSTRAINT si_customs_override_duty_positive
    CHECK (customs_override_duty_usd IS NULL OR customs_override_duty_usd > 0),
  ADD CONSTRAINT si_customs_override_metadata_pair
    CHECK ((customs_override_confirmed_at IS NULL) = (customs_override_by IS NULL));

-- 4) Metadata trigger function
CREATE OR REPLACE FUNCTION public.set_customs_override_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_confirm_mode text := current_setting('app.customs_override_confirm', true);
  v_identity_changed boolean := false;
  v_duty_changed boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_identity_changed :=
      (COALESCE(NEW.product_name,'') IS DISTINCT FROM COALESCE(OLD.product_name,''))
      OR (COALESCE(NEW.origin_country,'') IS DISTINCT FROM COALESCE(OLD.origin_country,''));
    v_duty_changed :=
      (COALESCE(NEW.customs_override_duty_usd, -1) IS DISTINCT FROM COALESCE(OLD.customs_override_duty_usd, -1));
  END IF;

  -- Identity change: wipe everything (override no longer valid for new product/country)
  IF v_identity_changed THEN
    NEW.customs_override_duty_usd := NULL;
    NEW.customs_override_confirmed_at := NULL;
    NEW.customs_override_by := NULL;
    RETURN NEW;
  END IF;

  -- Confirmation flow (RPC): allow setting confirmed_at/by
  IF v_confirm_mode = 'on' THEN
    RETURN NEW;
  END IF;

  -- Outside confirmation flow: client must never set confirmed_at/by directly.
  -- Strip them; also clear if duty was changed.
  IF TG_OP = 'INSERT' THEN
    NEW.customs_override_confirmed_at := NULL;
    NEW.customs_override_by := NULL;
  ELSIF v_duty_changed THEN
    NEW.customs_override_confirmed_at := NULL;
    NEW.customs_override_by := NULL;
  ELSE
    -- duty unchanged: prevent direct tampering of confirmed_at/by
    NEW.customs_override_confirmed_at := OLD.customs_override_confirmed_at;
    NEW.customs_override_by := OLD.customs_override_by;
  END IF;

  RETURN NEW;
END;
$$;

-- 5) Attach metadata trigger to manager_offers (name sorts before manager_offers_* and trg_*)
DROP TRIGGER IF EXISTS aa_set_customs_override_metadata ON public.manager_offers;
CREATE TRIGGER aa_set_customs_override_metadata
  BEFORE INSERT OR UPDATE ON public.manager_offers
  FOR EACH ROW EXECUTE FUNCTION public.set_customs_override_metadata();

-- 6) Attach metadata trigger to shipment_items (name sorts before trg_02_*)
DROP TRIGGER IF EXISTS aa_set_customs_override_metadata ON public.shipment_items;
CREATE TRIGGER aa_set_customs_override_metadata
  BEFORE INSERT OR UPDATE ON public.shipment_items
  FOR EACH ROW EXECUTE FUNCTION public.set_customs_override_metadata();

-- 7) Recreate trg_02_shipment_item_costs with extended UPDATE OF list
DROP TRIGGER IF EXISTS trg_02_shipment_item_costs ON public.shipment_items;
CREATE TRIGGER trg_02_shipment_item_costs
  BEFORE INSERT OR UPDATE OF
    unit_price, price_currency, unit_price_usd, product_name,
    shipment_id, pallet_count, pallet_weight,
    origin_country,
    customs_override_duty_usd, customs_override_confirmed_at
  ON public.shipment_items
  FOR EACH ROW EXECUTE FUNCTION public.calc_shipment_item_costs();

-- 8) Replace calc_shipment_item_costs with RED override branch on top
CREATE OR REPLACE FUNCTION public.calc_shipment_item_costs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  ship_country text;
  ship_vehicle uuid;
  ship_log_usd numeric;
  vehicle_log_usd numeric := 0;
  v_status text;
  v_real_pallets numeric := 0;
  expected_pallets numeric := 0;
  pallet_w numeric;
  freight_per_pallet numeric := 0;
  transport_per_kg numeric := 0;
  ref_row public.customs_reference%ROWTYPE;
  origin text;
  is_eu boolean;
  pct numeric;
  unit_usd numeric;
  duty_invoice numeric;
  lookup_name text;
BEGIN
  SELECT country, vehicle_id, COALESCE(logistics_cost_usd,0)
    INTO ship_country, ship_vehicle, ship_log_usd
    FROM public.shipments WHERE id = NEW.shipment_id;

  origin := COALESCE(NULLIF(btrim(NEW.origin_country),''), ship_country);

  unit_usd := COALESCE(NEW.unit_price_usd, 0);

  -- RED override branch: confirmed manual митний збір short-circuits customs lookup
  IF NEW.customs_override_duty_usd IS NOT NULL
     AND NEW.customs_override_confirmed_at IS NOT NULL THEN
    NEW.customs_match_id := NULL;
    NEW.customs_cost_indicative := NEW.customs_override_duty_usd;
    NEW.customs_cost_invoice := NEW.customs_override_duty_usd;
  ELSE
    -- product aliases for customs lookup
    lookup_name := CASE lower(btrim(COALESCE(NEW.product_name,'')))
      WHEN 'інжирний персик' THEN 'персик'
      WHEN 'платерина нектарин' THEN 'нектарин'
      ELSE COALESCE(NEW.product_name,'')
    END;

    -- 1) try exact product + country match
    SELECT * INTO ref_row FROM public.customs_reference
     WHERE active = true
       AND lower(btrim(product_name)) = lower(btrim(lookup_name))
       AND lower(btrim(country)) = lower(btrim(COALESCE(origin,'')))
     ORDER BY threshold_price_usd DESC
     LIMIT 1;

    -- 2) fallback: same product, any country, pick row with highest indicative
    IF ref_row.id IS NULL THEN
      SELECT * INTO ref_row FROM public.customs_reference
       WHERE active = true
         AND lower(btrim(product_name)) = lower(btrim(lookup_name))
       ORDER BY euro1_markup_usd DESC NULLS LAST, threshold_price_usd DESC
       LIMIT 1;
    END IF;

    IF ref_row.id IS NULL THEN
      NEW.customs_match_id := NULL;
      NEW.customs_cost_indicative := 0;
      NEW.customs_cost_invoice := 0;
    ELSE
      NEW.customs_match_id := ref_row.id;
      NEW.customs_cost_indicative := COALESCE(ref_row.euro1_markup_usd, 0);
      is_eu := public.is_eu_country(ref_row.country);
      IF unit_usd <= COALESCE(ref_row.threshold_price_usd, 0) THEN
        NEW.customs_cost_invoice := COALESCE(ref_row.euro1_markup_usd, 0);
      ELSE
        pct := CASE WHEN is_eu THEN COALESCE(ref_row.euro1_percent, 0)
                    ELSE COALESCE(ref_row.customs_fee_percent, 0) END;
        duty_invoice := (unit_usd * 1.20 * pct / 100.0) + (unit_usd * 0.20) + 0.02;
        NEW.customs_cost_invoice := duty_invoice;
      END IF;
    END IF;
  END IF;

  -- Freight / final cost assembly (unchanged)
  IF ship_vehicle IS NOT NULL THEN
    SELECT v.status::text, COALESCE(v.total_pallets,0)
      INTO v_status, v_real_pallets
      FROM public.vehicles v WHERE v.id = ship_vehicle;

    SELECT COALESCE(SUM(COALESCE(s.logistics_cost_usd,0)),0)
      INTO vehicle_log_usd
      FROM public.shipments s
     WHERE s.vehicle_id = ship_vehicle;
  ELSE
    v_status := 'open';
    vehicle_log_usd := ship_log_usd;
    SELECT COALESCE(SUM(COALESCE(pallet_count,0)),0)
      INTO v_real_pallets
      FROM public.shipment_items WHERE shipment_id = NEW.shipment_id;
  END IF;

  pallet_w := COALESCE(NEW.pallet_weight, 0);

  IF v_status = 'closed' THEN
    expected_pallets := GREATEST(v_real_pallets, 0);
  ELSE
    IF pallet_w > 0 THEN
      expected_pallets := LEAST(26, FLOOR(21500.0 / pallet_w));
      IF expected_pallets < 1 THEN expected_pallets := 1; END IF;
    ELSE
      expected_pallets := 26;
    END IF;
  END IF;

  IF expected_pallets > 0 THEN
    freight_per_pallet := vehicle_log_usd / expected_pallets;
  END IF;
  IF pallet_w > 0 THEN
    transport_per_kg := freight_per_pallet / pallet_w;
  END IF;

  NEW.final_cost_indicative := COALESCE(unit_usd,0) + transport_per_kg + COALESCE(NEW.customs_cost_indicative,0);
  NEW.final_cost_invoice    := COALESCE(unit_usd,0) + transport_per_kg + COALESCE(NEW.customs_cost_invoice,0);

  RETURN NEW;
END;
$function$;

-- 9) is_customs_red — internal only
CREATE OR REPLACE FUNCTION public.is_customs_red(p_product text, p_country text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lookup_name text;
  v_exists boolean;
BEGIN
  lookup_name := CASE lower(btrim(COALESCE(p_product,'')))
    WHEN 'інжирний персик' THEN 'персик'
    WHEN 'платерина нектарин' THEN 'нектарин'
    ELSE COALESCE(p_product,'')
  END;

  -- RED = product missing completely from customs_reference (any country)
  SELECT EXISTS (
    SELECT 1 FROM public.customs_reference
     WHERE active = true
       AND lower(btrim(product_name)) = lower(btrim(lookup_name))
  ) INTO v_exists;

  RETURN NOT v_exists;
END;
$$;

REVOKE ALL ON FUNCTION public.is_customs_red(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_customs_red(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.is_customs_red(text, text) FROM authenticated;

-- 10) confirm_manager_offer_customs_override
CREATE OR REPLACE FUNCTION public.confirm_manager_offer_customs_override(
  p_offer_id uuid,
  p_duty numeric
)
RETURNS public.manager_offers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_offer public.manager_offers%ROWTYPE;
  v_unit_usd numeric;
  v_transport_per_kg numeric := 0;
  v_freight_usd numeric := 0;
  v_pallet_w numeric;
  v_expected_pallets numeric := 26;
  v_freight_per_pallet numeric := 0;
  v_fx numeric;
  v_final numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_duty IS NULL OR p_duty <= 0 THEN
    RAISE EXCEPTION 'duty_usd must be > 0' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_offer FROM public.manager_offers WHERE id = p_offer_id FOR UPDATE;
  IF v_offer.id IS NULL THEN
    RAISE EXCEPTION 'manager_offer not found' USING ERRCODE = 'P0002';
  END IF;

  -- ownership/auth: admin OR creator
  IF NOT (public.is_admin(v_uid) OR v_offer.created_by = v_uid) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  -- RED guard: only allowed when product is missing from customs_reference
  IF NOT public.is_customs_red(v_offer.product_name, v_offer.origin_country) THEN
    RAISE EXCEPTION 'manual customs override not allowed: product is in customs_reference' USING ERRCODE = '22023';
  END IF;

  -- compute unit_usd, transport_per_kg from existing fields
  v_fx := COALESCE(v_offer.fx_rate_snapshot, 1);
  v_unit_usd := CASE
    WHEN upper(COALESCE(v_offer.price_currency,'EUR')) = 'USD' THEN COALESCE(v_offer.price_per_kg,0)
    ELSE COALESCE(v_offer.price_per_kg,0) * v_fx
  END;

  v_freight_usd := CASE
    WHEN upper(COALESCE(v_offer.freight_currency,'EUR')) = 'USD' THEN COALESCE(v_offer.freight_amount,0)
    ELSE COALESCE(v_offer.freight_amount,0) * v_fx
  END;

  v_pallet_w := COALESCE(v_offer.pallet_weight, 0);
  IF v_pallet_w > 0 THEN
    v_expected_pallets := LEAST(26, FLOOR(21500.0 / v_pallet_w));
    IF v_expected_pallets < 1 THEN v_expected_pallets := 1; END IF;
  END IF;

  IF v_expected_pallets > 0 THEN
    v_freight_per_pallet := v_freight_usd / v_expected_pallets;
  END IF;
  IF v_pallet_w > 0 THEN
    v_transport_per_kg := v_freight_per_pallet / v_pallet_w;
  END IF;

  v_final := v_unit_usd + v_transport_per_kg + p_duty;

  -- write under confirmation flow signal
  PERFORM set_config('app.customs_override_confirm', 'on', true);

  UPDATE public.manager_offers
     SET customs_override_duty_usd = p_duty,
         customs_override_confirmed_at = now(),
         customs_override_by = v_uid,
         indicative_cost_usd = v_final,
         invoice_cost_usd = v_final,
         updated_at = now()
   WHERE id = p_offer_id
   RETURNING * INTO v_offer;

  PERFORM set_config('app.customs_override_confirm', 'off', true);

  RETURN v_offer;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_manager_offer_customs_override(uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_manager_offer_customs_override(uuid, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.confirm_manager_offer_customs_override(uuid, numeric) TO authenticated;

-- 11) confirm_shipment_item_customs_override
CREATE OR REPLACE FUNCTION public.confirm_shipment_item_customs_override(
  p_item_id uuid,
  p_duty numeric
)
RETURNS public.shipment_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_item public.shipment_items%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_duty IS NULL OR p_duty <= 0 THEN
    RAISE EXCEPTION 'duty_usd must be > 0' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item FROM public.shipment_items WHERE id = p_item_id FOR UPDATE;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'shipment_item not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (public.is_admin(v_uid) OR public.is_shipment_owner(v_item.shipment_id, v_uid)) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_customs_red(v_item.product_name, v_item.origin_country) THEN
    RAISE EXCEPTION 'manual customs override not allowed: product is in customs_reference' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.customs_override_confirm', 'on', true);

  UPDATE public.shipment_items
     SET customs_override_duty_usd = p_duty,
         customs_override_confirmed_at = now(),
         customs_override_by = v_uid
   WHERE id = p_item_id
   RETURNING * INTO v_item;

  PERFORM set_config('app.customs_override_confirm', 'off', true);

  RETURN v_item;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_shipment_item_customs_override(uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_shipment_item_customs_override(uuid, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.confirm_shipment_item_customs_override(uuid, numeric) TO authenticated;

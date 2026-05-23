-- ========================================================================
-- 9F Phase C1 — net/gross weight split in calc_shipment_item_costs
-- Migration runner provides the outer transaction; explicit BEGIN/COMMIT
-- omitted so RAISE EXCEPTION in the postflight DO block rolls back the
-- entire migration atomically.
-- ========================================================================

-- STEP 1: Snapshot data + trigger state
CREATE TEMP TABLE _fc_before ON COMMIT DROP AS
SELECT
  id,
  pallet_count,
  pallet_weight,
  net_weight_kg,
  gross_weight_kg,
  qty,
  unit_price_usd,
  product_name,
  customs_match_id,
  customs_cost_indicative,
  customs_cost_invoice,
  final_cost_indicative,
  final_cost_invoice
FROM public.shipment_items;

CREATE TEMP TABLE _triggers_before ON COMMIT DROP AS
SELECT pt.tgname, pt.tgenabled
FROM pg_trigger pt
JOIN pg_class c ON c.oid = pt.tgrelid
WHERE c.relname = 'shipment_items'
  AND c.relnamespace = 'public'::regnamespace
  AND NOT pt.tgisinternal;

-- STEP 2: Replace calc_shipment_item_costs() — production body, only weight block changed
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
  pallet_w_legacy numeric;
  pc numeric;
  net_total numeric;
  gross_total numeric;
  gross_per_pallet numeric;
  net_per_pallet numeric;
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

  IF NEW.customs_override_duty_usd IS NOT NULL
     AND NEW.customs_override_confirmed_at IS NOT NULL THEN
    NEW.customs_match_id := NULL;
    NEW.customs_cost_indicative := NEW.customs_override_duty_usd;
    NEW.customs_cost_invoice := NEW.customs_override_duty_usd;
  ELSE
    lookup_name := CASE lower(btrim(COALESCE(NEW.product_name,'')))
      WHEN 'інжирний персик' THEN 'персик'
      WHEN 'платерина нектарин' THEN 'нектарин'
      ELSE COALESCE(NEW.product_name,'')
    END;

    SELECT * INTO ref_row FROM public.customs_reference
     WHERE active = true
       AND lower(btrim(product_name)) = lower(btrim(lookup_name))
       AND lower(btrim(country)) = lower(btrim(COALESCE(origin,'')))
     ORDER BY threshold_price_usd DESC
     LIMIT 1;

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

  -- === Phase C weight split (only changed block) ===
  pallet_w_legacy := COALESCE(NEW.pallet_weight, 0);
  pc              := COALESCE(NEW.pallet_count, 0);
  net_total       := COALESCE(NEW.net_weight_kg, 0);
  gross_total     := COALESCE(NEW.gross_weight_kg, 0);

  IF pc > 0 AND gross_total > 0 THEN
    gross_per_pallet := gross_total / pc;
  ELSE
    gross_per_pallet := pallet_w_legacy;
  END IF;

  IF pc > 0 AND net_total > 0 THEN
    net_per_pallet := net_total / pc;
  ELSE
    net_per_pallet := pallet_w_legacy;
  END IF;

  IF v_status = 'closed' THEN
    expected_pallets := GREATEST(v_real_pallets, 0);
  ELSE
    IF gross_per_pallet > 0 THEN
      expected_pallets := LEAST(26, FLOOR(21500.0 / gross_per_pallet));
      IF expected_pallets < 1 THEN expected_pallets := 1; END IF;
    ELSE
      expected_pallets := 26;
    END IF;
  END IF;

  IF expected_pallets > 0 THEN
    freight_per_pallet := vehicle_log_usd / expected_pallets;
  END IF;
  IF net_per_pallet > 0 THEN
    transport_per_kg := freight_per_pallet / net_per_pallet;
  END IF;
  -- === end Phase C weight split ===

  NEW.final_cost_indicative := COALESCE(unit_usd,0) + transport_per_kg + COALESCE(NEW.customs_cost_indicative,0);
  NEW.final_cost_invoice    := COALESCE(unit_usd,0) + transport_per_kg + COALESCE(NEW.customs_cost_invoice,0);

  RETURN NEW;
END;
$function$;

-- STEP 3: Recreate trigger — live UPDATE OF list + net_weight_kg + gross_weight_kg
DROP TRIGGER IF EXISTS trg_02_shipment_item_costs ON public.shipment_items;
CREATE TRIGGER trg_02_shipment_item_costs
BEFORE INSERT OR UPDATE OF
  unit_price,
  price_currency,
  unit_price_usd,
  product_name,
  shipment_id,
  pallet_count,
  pallet_weight,
  net_weight_kg,
  gross_weight_kg,
  origin_country,
  customs_override_duty_usd,
  customs_override_confirmed_at
ON public.shipment_items
FOR EACH ROW
EXECUTE FUNCTION public.calc_shipment_item_costs();

-- STEP 4: Disable side-effect triggers for the recompute window
ALTER TABLE public.shipment_items DISABLE TRIGGER trg_shipment_items_lock;
ALTER TABLE public.shipment_items DISABLE TRIGGER trg_03_log_shipment_item_changes;
ALTER TABLE public.shipment_items DISABLE TRIGGER si_recompute_vehicle_costs;
ALTER TABLE public.shipment_items DISABLE TRIGGER trg_shipment_items_vehicle_totals;
ALTER TABLE public.shipment_items DISABLE TRIGGER trg_normalize_shipment_item_name;

-- STEP 5: No-op recompute via net_weight_kg
UPDATE public.shipment_items SET net_weight_kg = net_weight_kg;

-- STEP 6: Re-enable disabled triggers
ALTER TABLE public.shipment_items ENABLE TRIGGER trg_shipment_items_lock;
ALTER TABLE public.shipment_items ENABLE TRIGGER trg_03_log_shipment_item_changes;
ALTER TABLE public.shipment_items ENABLE TRIGGER si_recompute_vehicle_costs;
ALTER TABLE public.shipment_items ENABLE TRIGGER trg_shipment_items_vehicle_totals;
ALTER TABLE public.shipment_items ENABLE TRIGGER trg_normalize_shipment_item_name;

-- STEP 7: Postflight — strict diff + trigger parity + abort on unexpected
DO $post$
DECLARE
  eps                          numeric := 0.0001;
  unit_price_usd_diff          int;
  product_name_diff            int;
  pallet_count_diff            int;
  pallet_weight_diff           int;
  qty_diff                     int;
  customs_match_id_diff        int;
  customs_cost_ind_diff        int;
  customs_cost_inv_diff        int;
  fc_ind_legacy_diff           int;
  fc_inv_legacy_diff           int;
  fc_ind_split_diff            int;
  fc_inv_split_diff            int;
  fc_unexpected_diff           int;
  bvp_split_rows               int;
  missing_or_changed_triggers  int;
  extra_or_changed_triggers    int;
  trg02_ok                     boolean;
BEGIN
  SELECT count(*) INTO unit_price_usd_diff
  FROM _fc_before b JOIN public.shipment_items a USING (id)
  WHERE a.unit_price_usd IS DISTINCT FROM b.unit_price_usd;

  SELECT count(*) INTO product_name_diff
  FROM _fc_before b JOIN public.shipment_items a USING (id)
  WHERE a.product_name IS DISTINCT FROM b.product_name;

  SELECT count(*) INTO pallet_count_diff
  FROM _fc_before b JOIN public.shipment_items a USING (id)
  WHERE a.pallet_count IS DISTINCT FROM b.pallet_count;

  SELECT count(*) INTO pallet_weight_diff
  FROM _fc_before b JOIN public.shipment_items a USING (id)
  WHERE a.pallet_weight IS DISTINCT FROM b.pallet_weight;

  SELECT count(*) INTO qty_diff
  FROM _fc_before b JOIN public.shipment_items a USING (id)
  WHERE a.qty IS DISTINCT FROM b.qty;

  SELECT count(*) INTO customs_match_id_diff
  FROM _fc_before b JOIN public.shipment_items a USING (id)
  WHERE a.customs_match_id IS DISTINCT FROM b.customs_match_id;

  SELECT count(*) INTO customs_cost_ind_diff
  FROM _fc_before b JOIN public.shipment_items a USING (id)
  WHERE (a.customs_cost_indicative IS NULL) <> (b.customs_cost_indicative IS NULL)
     OR (a.customs_cost_indicative IS NOT NULL AND b.customs_cost_indicative IS NOT NULL
         AND abs(a.customs_cost_indicative - b.customs_cost_indicative) > eps);

  SELECT count(*) INTO customs_cost_inv_diff
  FROM _fc_before b JOIN public.shipment_items a USING (id)
  WHERE (a.customs_cost_invoice IS NULL) <> (b.customs_cost_invoice IS NULL)
     OR (a.customs_cost_invoice IS NOT NULL AND b.customs_cost_invoice IS NOT NULL
         AND abs(a.customs_cost_invoice - b.customs_cost_invoice) > eps);

  SELECT count(*) INTO fc_ind_legacy_diff
  FROM _fc_before b JOIN public.shipment_items a USING (id)
  WHERE COALESCE(b.net_weight_kg,0) = COALESCE(b.gross_weight_kg,0)
    AND COALESCE(b.net_weight_kg,0) = COALESCE(b.pallet_count,0) * COALESCE(b.pallet_weight,0)
    AND ((a.final_cost_indicative IS NULL) <> (b.final_cost_indicative IS NULL)
         OR (a.final_cost_indicative IS NOT NULL AND b.final_cost_indicative IS NOT NULL
             AND abs(a.final_cost_indicative - b.final_cost_indicative) > eps));

  SELECT count(*) INTO fc_inv_legacy_diff
  FROM _fc_before b JOIN public.shipment_items a USING (id)
  WHERE COALESCE(b.net_weight_kg,0) = COALESCE(b.gross_weight_kg,0)
    AND COALESCE(b.net_weight_kg,0) = COALESCE(b.pallet_count,0) * COALESCE(b.pallet_weight,0)
    AND ((a.final_cost_invoice IS NULL) <> (b.final_cost_invoice IS NULL)
         OR (a.final_cost_invoice IS NOT NULL AND b.final_cost_invoice IS NOT NULL
             AND abs(a.final_cost_invoice - b.final_cost_invoice) > eps));

  SELECT count(*) INTO fc_ind_split_diff
  FROM _fc_before b JOIN public.shipment_items a USING (id)
  WHERE COALESCE(b.net_weight_kg,0) <> COALESCE(b.gross_weight_kg,0)
    AND a.final_cost_indicative IS DISTINCT FROM b.final_cost_indicative;

  SELECT count(*) INTO fc_inv_split_diff
  FROM _fc_before b JOIN public.shipment_items a USING (id)
  WHERE COALESCE(b.net_weight_kg,0) <> COALESCE(b.gross_weight_kg,0)
    AND a.final_cost_invoice IS DISTINCT FROM b.final_cost_invoice;

  SELECT count(*) INTO fc_unexpected_diff
  FROM _fc_before b JOIN public.shipment_items a USING (id)
  WHERE COALESCE(b.net_weight_kg,0) = COALESCE(b.gross_weight_kg,0)
    AND NOT (COALESCE(b.net_weight_kg,0) = COALESCE(b.pallet_count,0) * COALESCE(b.pallet_weight,0))
    AND (a.final_cost_indicative IS DISTINCT FROM b.final_cost_indicative
         OR a.final_cost_invoice  IS DISTINCT FROM b.final_cost_invoice);

  SELECT count(*) INTO bvp_split_rows
  FROM public.branch_visible_prices bvp
  JOIN _fc_before b ON b.id = bvp.shipment_item_id
  WHERE COALESCE(b.net_weight_kg,0) <> COALESCE(b.gross_weight_kg,0);

  SELECT count(*) INTO missing_or_changed_triggers
  FROM _triggers_before b
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_trigger pt
    JOIN pg_class c ON c.oid = pt.tgrelid
    WHERE c.relname = 'shipment_items'
      AND c.relnamespace = 'public'::regnamespace
      AND NOT pt.tgisinternal
      AND pt.tgname = b.tgname
      AND pt.tgenabled = b.tgenabled
  );

  SELECT count(*) INTO extra_or_changed_triggers
  FROM pg_trigger pt
  JOIN pg_class c ON c.oid = pt.tgrelid
  WHERE c.relname = 'shipment_items'
    AND c.relnamespace = 'public'::regnamespace
    AND NOT pt.tgisinternal
    AND NOT EXISTS (
      SELECT 1
      FROM _triggers_before b
      WHERE b.tgname = pt.tgname
        AND b.tgenabled = pt.tgenabled
    );

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger pt
    JOIN pg_class c ON c.oid = pt.tgrelid
    WHERE c.relname = 'shipment_items'
      AND pt.tgname = 'trg_02_shipment_item_costs'
      AND NOT pt.tgisinternal
      AND pt.tgenabled <> 'D'
  ) INTO trg02_ok;

  RAISE NOTICE '--- Phase C1 postflight ---';
  RAISE NOTICE 'STRICT no-change (must be 0):';
  RAISE NOTICE '  unit_price_usd_diff   = %', unit_price_usd_diff;
  RAISE NOTICE '  product_name_diff     = %', product_name_diff;
  RAISE NOTICE '  pallet_count_diff     = %', pallet_count_diff;
  RAISE NOTICE '  pallet_weight_diff    = %', pallet_weight_diff;
  RAISE NOTICE '  qty_diff              = %', qty_diff;
  RAISE NOTICE '  customs_match_id_diff = %', customs_match_id_diff;
  RAISE NOTICE '  customs_cost_ind_diff = %', customs_cost_ind_diff;
  RAISE NOTICE '  customs_cost_inv_diff = %', customs_cost_inv_diff;
  RAISE NOTICE 'final_cost legacy-equivalent (must be 0):';
  RAISE NOTICE '  fc_ind_legacy_diff = %', fc_ind_legacy_diff;
  RAISE NOTICE '  fc_inv_legacy_diff = %', fc_inv_legacy_diff;
  RAISE NOTICE 'final_cost split rows (reported):';
  RAISE NOTICE '  fc_ind_split_diff  = %', fc_ind_split_diff;
  RAISE NOTICE '  fc_inv_split_diff  = %', fc_inv_split_diff;
  RAISE NOTICE 'final_cost unexpected (must be 0):';
  RAISE NOTICE '  fc_unexpected_diff = %', fc_unexpected_diff;
  RAISE NOTICE 'BVP rows over split shipment_items (reported): %', bvp_split_rows;
  RAISE NOTICE 'Trigger parity (both must be 0):';
  RAISE NOTICE '  missing_or_changed_triggers = %', missing_or_changed_triggers;
  RAISE NOTICE '  extra_or_changed_triggers   = %', extra_or_changed_triggers;
  RAISE NOTICE 'trg_02_shipment_item_costs enabled: %', trg02_ok;

  IF unit_price_usd_diff   <> 0 THEN RAISE EXCEPTION 'C1 abort: unit_price_usd drifted (% rows)', unit_price_usd_diff; END IF;
  IF product_name_diff     <> 0 THEN RAISE EXCEPTION 'C1 abort: product_name drifted (% rows)', product_name_diff; END IF;
  IF pallet_count_diff     <> 0 THEN RAISE EXCEPTION 'C1 abort: pallet_count drifted (% rows)', pallet_count_diff; END IF;
  IF pallet_weight_diff    <> 0 THEN RAISE EXCEPTION 'C1 abort: pallet_weight drifted (% rows)', pallet_weight_diff; END IF;
  IF qty_diff              <> 0 THEN RAISE EXCEPTION 'C1 abort: qty drifted (% rows)', qty_diff; END IF;
  IF customs_match_id_diff <> 0 THEN RAISE EXCEPTION 'C1 abort: customs_match_id drifted (% rows)', customs_match_id_diff; END IF;
  IF customs_cost_ind_diff <> 0 THEN RAISE EXCEPTION 'C1 abort: customs_cost_indicative drifted (% rows)', customs_cost_ind_diff; END IF;
  IF customs_cost_inv_diff <> 0 THEN RAISE EXCEPTION 'C1 abort: customs_cost_invoice drifted (% rows)', customs_cost_inv_diff; END IF;
  IF fc_ind_legacy_diff    <> 0 THEN RAISE EXCEPTION 'C1 abort: final_cost_indicative drifted on legacy-equivalent (% rows)', fc_ind_legacy_diff; END IF;
  IF fc_inv_legacy_diff    <> 0 THEN RAISE EXCEPTION 'C1 abort: final_cost_invoice drifted on legacy-equivalent (% rows)', fc_inv_legacy_diff; END IF;
  IF fc_unexpected_diff    <> 0 THEN RAISE EXCEPTION 'C1 abort: final_cost drifted on unexpected class (% rows)', fc_unexpected_diff; END IF;
  IF missing_or_changed_triggers <> 0 THEN
    RAISE EXCEPTION 'C1 abort: % triggers missing or tgenabled changed vs pre-migration snapshot', missing_or_changed_triggers;
  END IF;
  IF extra_or_changed_triggers <> 0 THEN
    RAISE EXCEPTION 'C1 abort: % extra triggers or tgenabled changed vs pre-migration snapshot', extra_or_changed_triggers;
  END IF;
  IF NOT trg02_ok THEN RAISE EXCEPTION 'C1 abort: trg_02_shipment_item_costs missing or disabled'; END IF;
END
$post$;
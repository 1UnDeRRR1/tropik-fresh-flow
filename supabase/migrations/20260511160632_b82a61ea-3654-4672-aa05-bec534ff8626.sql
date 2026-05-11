-- 1. Add euro1_percent column
ALTER TABLE public.customs_reference ADD COLUMN IF NOT EXISTS euro1_percent numeric NOT NULL DEFAULT 0;

-- 2. EU detection by Ukrainian country name (uppercase form used in customs base)
CREATE OR REPLACE FUNCTION public.is_eu_country(_country text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT upper(btrim(coalesce(_country,''))) = ANY (ARRAY[
    'АВСТРІЯ','БЕЛЬГІЯ','БОЛГАРІЯ','ХОРВАТІЯ','КІПР','ЧЕХІЯ','ДАНІЯ',
    'ЕСТОНІЯ','ФІНЛЯНДІЯ','ФРАНЦІЯ','НІМЕЧЧИНА','ГРЕЦІЯ','УГОРЩИНА',
    'ІРЛАНДІЯ','ІТАЛІЯ','ЛАТВІЯ','ЛИТВА','ЛЮКСЕМБУРГ','МАЛЬТА',
    'НІДЕРЛАНДИ','ПОЛЬЩА','ПОРТУГАЛІЯ','РУМУНІЯ','СЛОВАЧЧИНА',
    'СЛОВЕНІЯ','ІСПАНІЯ','ШВЕЦІЯ'
  ])
$$;

-- 3. Updated cost calculation trigger: EU-aware + pallet-based transport
CREATE OR REPLACE FUNCTION public.calc_shipment_item_costs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ship_country text;
  ship_vehicle uuid;
  ship_log_usd numeric;
  vehicle_log_usd numeric := 0;
  vehicle_total_pallets numeric := 0;
  pallet_w numeric;
  freight_per_pallet numeric := 0;
  transport_per_kg numeric := 0;
  ref_row public.customs_reference%ROWTYPE;
  origin text;
  is_eu boolean;
  pct numeric;
  unit_usd numeric;
  duty_invoice numeric;
BEGIN
  SELECT country, vehicle_id, COALESCE(logistics_cost_usd,0)
    INTO ship_country, ship_vehicle, ship_log_usd
    FROM public.shipments WHERE id = NEW.shipment_id;

  origin := COALESCE(NULLIF(btrim(NEW.origin_country),''), ship_country);
  is_eu := public.is_eu_country(origin);

  -- Lookup customs row by product + ORIGIN country (NOT loading country)
  SELECT * INTO ref_row FROM public.customs_reference
   WHERE active = true
     AND lower(btrim(product_name)) = lower(btrim(COALESCE(NEW.product_name,'')))
     AND lower(btrim(country)) = lower(btrim(COALESCE(origin,'')))
   ORDER BY threshold_price_usd DESC
   LIMIT 1;

  unit_usd := COALESCE(NEW.unit_price_usd, 0);

  IF ref_row.id IS NULL THEN
    NEW.customs_match_id := NULL;
    NEW.customs_cost_indicative := 0;
    NEW.customs_cost_invoice := 0;
  ELSE
    NEW.customs_match_id := ref_row.id;
    NEW.customs_cost_indicative := COALESCE(ref_row.euro1_markup_usd, 0);
    IF unit_usd <= COALESCE(ref_row.threshold_price_usd, 0) THEN
      NEW.customs_cost_invoice := COALESCE(ref_row.euro1_markup_usd, 0);
    ELSE
      pct := CASE WHEN is_eu THEN COALESCE(ref_row.euro1_percent, 0)
                  ELSE COALESCE(ref_row.customs_fee_percent, 0) END;
      duty_invoice := (unit_usd * 1.20 * pct / 100.0) + (unit_usd * 0.20) + 0.02;
      NEW.customs_cost_invoice := duty_invoice;
    END IF;
  END IF;

  -- Pallet-based transport: freight_per_pallet / pallet_weight
  IF ship_vehicle IS NOT NULL THEN
    SELECT COALESCE(SUM(COALESCE(s.logistics_cost_usd,0)),0),
           COALESCE(SUM(COALESCE(si.pallet_count,0)),0)
      INTO vehicle_log_usd, vehicle_total_pallets
      FROM public.shipments s
      LEFT JOIN public.shipment_items si ON si.shipment_id = s.id
     WHERE s.vehicle_id = ship_vehicle;
  ELSE
    vehicle_log_usd := ship_log_usd;
    SELECT COALESCE(SUM(COALESCE(pallet_count,0)),0)
      INTO vehicle_total_pallets
      FROM public.shipment_items WHERE shipment_id = NEW.shipment_id;
  END IF;

  IF vehicle_total_pallets > 0 THEN
    freight_per_pallet := vehicle_log_usd / vehicle_total_pallets;
  END IF;
  pallet_w := COALESCE(NEW.pallet_weight, 0);
  IF pallet_w > 0 THEN
    transport_per_kg := freight_per_pallet / pallet_w;
  END IF;

  NEW.final_cost_indicative := unit_usd + transport_per_kg + COALESCE(NEW.customs_cost_indicative,0);
  NEW.final_cost_invoice    := unit_usd + transport_per_kg + COALESCE(NEW.customs_cost_invoice,0);

  RETURN NEW;
END;
$$;

-- 4. Helpful index for trigger lookup
CREATE INDEX IF NOT EXISTS customs_reference_lookup_idx
  ON public.customs_reference (lower(btrim(product_name)), lower(btrim(country)), threshold_price_usd DESC)
  WHERE active = true;
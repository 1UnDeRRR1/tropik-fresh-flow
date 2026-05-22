-- Patch 6A.2: localize error message in confirm_*_customs_override RPCs (Ukrainian).
-- Only the user-facing error string changes. Logic remains identical.

CREATE OR REPLACE FUNCTION public.confirm_manager_offer_customs_override(p_offer_id uuid, p_duty numeric)
RETURNS manager_offers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  IF NOT (public.is_admin(v_uid) OR v_offer.created_by = v_uid) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_customs_red(v_offer.product_name, v_offer.origin_country) THEN
    RAISE EXCEPTION 'Митна база містить цей товар; ручна сума митного збору неприпустима — використайте автоматичний розрахунок' USING ERRCODE = '22023';
  END IF;

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
$function$;

CREATE OR REPLACE FUNCTION public.confirm_shipment_item_customs_override(p_item_id uuid, p_duty numeric)
RETURNS shipment_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_item public.shipment_items%ROWTYPE;
  v_ship public.shipments%ROWTYPE;
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

  SELECT * INTO v_ship FROM public.shipments WHERE id = v_item.shipment_id;
  IF NOT (public.is_admin(v_uid) OR public.is_shipment_owner(v_item.shipment_id, v_uid)) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_customs_red(v_item.product_name, COALESCE(v_item.origin_country, v_ship.country)) THEN
    RAISE EXCEPTION 'Митна база містить цей товар; ручна сума митного збору неприпустима — використайте автоматичний розрахунок' USING ERRCODE = '22023';
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
$function$;
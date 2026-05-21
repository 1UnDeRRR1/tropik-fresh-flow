-- Patch 1D: trigger sync_manager_offer_distribution after successful allocation_parts insert.
-- Signatures, return types, SECURITY DEFINER, search_path, matching, capacity, remaining, locks,
-- legacy guard and grants are unchanged. Only adds PERFORM call after successful INSERT(s).

CREATE OR REPLACE FUNCTION public.link_response_to_shipment_item(p_response_id uuid, p_shipment_item_id uuid, p_pallets numeric, p_allow_caliber_mismatch boolean DEFAULT false, p_notes text DEFAULT NULL::text)
 RETURNS manager_offer_allocation_parts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid       uuid := auth.uid();
  v_response  public.manager_offer_responses%rowtype;
  v_offer     public.manager_offers%rowtype;
  v_item      public.shipment_items%rowtype;
  v_offer_id  uuid;

  v_op text; v_oc text; v_ocal text;
  v_ip text; v_ic text; v_ical text;

  v_distribution_used numeric;
  v_allocation_used   numeric;
  v_free_capacity     numeric;

  v_approved  numeric;
  v_ordered   numeric;
  v_cancelled numeric;
  v_remaining numeric;

  v_legacy_exists boolean;
  v_part public.manager_offer_allocation_parts;
begin
  if v_uid is null then raise exception 'FORBIDDEN'; end if;
  if p_pallets is null or p_pallets <= 0 then raise exception 'INVALID_PALLETS'; end if;

  select * into v_response from public.manager_offer_responses where id = p_response_id;
  if not found then raise exception 'RESPONSE_NOT_FOUND'; end if;
  v_offer_id := v_response.offer_id;

  if not (public.is_admin(v_uid) or public.owns_manager_offer(v_offer_id, v_uid)) then
    raise exception 'FORBIDDEN';
  end if;

  select exists (
    select 1 from public.manager_offer_shipment_links where offer_id = v_offer_id
  ) into v_legacy_exists;
  if v_legacy_exists then raise exception 'LEGACY_LINK_EXISTS'; end if;

  select * into v_offer from public.manager_offers where id = v_offer_id;
  if not found then raise exception 'OFFER_NOT_FOUND'; end if;

  -- LOCK ORDER: shipment_item FIRST.
  select * into v_item from public.shipment_items where id = p_shipment_item_id for update;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;

  select * into v_response from public.manager_offer_responses where id = p_response_id for update;
  if not found then raise exception 'RESPONSE_NOT_FOUND'; end if;
  if v_response.offer_id <> v_offer_id then raise exception 'RESPONSE_OFFER_CHANGED'; end if;

  -- Matching (after locks).
  v_op   := nullif(lower(trim(v_offer.product_name)),   '');
  v_oc   := nullif(lower(trim(v_offer.origin_country)), '');
  v_ocal := nullif(lower(trim(v_offer.caliber)),        '');
  v_ip   := nullif(lower(trim(v_item.product_name)),    '');
  v_ic   := nullif(lower(trim(v_item.origin_country)),  '');
  v_ical := nullif(lower(trim(v_item.caliber)),         '');

  if v_op is null or v_ip is null or v_op <> v_ip then raise exception 'PRODUCT_MISMATCH'; end if;
  if v_ic is null then raise exception 'COUNTRY_MISMATCH'; end if;
  if v_oc is not null and v_oc <> v_ic then raise exception 'COUNTRY_MISMATCH'; end if;
  if v_ocal is not null
     and (v_ical is null or v_ocal <> v_ical)
     and not coalesce(p_allow_caliber_mismatch, false) then
    raise exception 'CALIBER_MISMATCH';
  end if;

  select coalesce(sum(di.pallets), 0) into v_distribution_used
    from public.distribution_items di where di.shipment_item_id = v_item.id;

  select coalesce(sum(ap.pallets), 0) into v_allocation_used
    from public.manager_offer_allocation_parts ap
   where ap.shipment_item_id = v_item.id and ap.status = 'ordered';

  v_free_capacity := coalesce(v_item.pallet_count, 0)
                   - greatest(v_distribution_used, v_allocation_used);

  if v_free_capacity <= 0 or p_pallets > v_free_capacity then
    raise exception 'OVER_CAPACITY';
  end if;

  v_approved := coalesce(v_response.approved_pallets, 0);
  select coalesce(sum(pallets),0) into v_ordered
    from public.manager_offer_allocation_parts
   where response_id = v_response.id and status = 'ordered';
  select coalesce(sum(pallets),0) into v_cancelled
    from public.manager_offer_allocation_parts
   where response_id = v_response.id and status = 'cancelled';
  v_remaining := v_approved - v_ordered - v_cancelled;

  if v_remaining <= 0 then raise exception 'NOTHING_TO_ALLOCATE'; end if;
  if p_pallets > v_remaining then raise exception 'OVER_REMAINING'; end if;

  insert into public.manager_offer_allocation_parts (
    offer_id, response_id, branch_id,
    shipment_id, shipment_item_id,
    pallets, status, notes, created_by
  ) values (
    v_offer_id, v_response.id, v_response.branch_id,
    v_item.shipment_id, v_item.id,
    p_pallets, 'ordered', p_notes, v_uid
  )
  returning * into v_part;

  -- Patch 1D: sync distribution after successful insert.
  perform public.sync_manager_offer_distribution(v_offer_id);

  return v_part;
end;
$function$;

CREATE OR REPLACE FUNCTION public.link_offer_to_shipment_item_fifo(p_offer_id uuid, p_shipment_item_id uuid, p_max_pallets numeric DEFAULT NULL::numeric, p_allow_caliber_mismatch boolean DEFAULT false, p_notes text DEFAULT NULL::text)
 RETURNS SETOF manager_offer_allocation_parts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid   uuid := auth.uid();
  v_offer public.manager_offers%rowtype;
  v_item  public.shipment_items%rowtype;

  v_op text; v_oc text; v_ocal text;
  v_ip text; v_ic text; v_ical text;

  v_distribution_used numeric;
  v_allocation_used   numeric;
  v_free_capacity     numeric;
  v_budget            numeric;

  v_legacy_exists boolean;
  v_inserted_any  boolean := false;

  r_resp record;
  v_approved numeric; v_ordered numeric; v_cancelled numeric; v_remaining numeric;
  v_take numeric;
  v_part public.manager_offer_allocation_parts;
begin
  if v_uid is null then raise exception 'FORBIDDEN'; end if;

  -- v11: OFFER_NOT_FOUND BEFORE authorization.
  select * into v_offer from public.manager_offers where id = p_offer_id;
  if not found then raise exception 'OFFER_NOT_FOUND'; end if;

  if not (public.is_admin(v_uid) or public.owns_manager_offer(p_offer_id, v_uid)) then
    raise exception 'FORBIDDEN';
  end if;

  select exists (
    select 1 from public.manager_offer_shipment_links where offer_id = p_offer_id
  ) into v_legacy_exists;
  if v_legacy_exists then raise exception 'LEGACY_LINK_EXISTS'; end if;

  -- LOCK ORDER: shipment_item FIRST.
  select * into v_item from public.shipment_items where id = p_shipment_item_id for update;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;

  -- Matching after lock.
  v_op   := nullif(lower(trim(v_offer.product_name)),   '');
  v_oc   := nullif(lower(trim(v_offer.origin_country)), '');
  v_ocal := nullif(lower(trim(v_offer.caliber)),        '');
  v_ip   := nullif(lower(trim(v_item.product_name)),    '');
  v_ic   := nullif(lower(trim(v_item.origin_country)),  '');
  v_ical := nullif(lower(trim(v_item.caliber)),         '');

  if v_op is null or v_ip is null or v_op <> v_ip then raise exception 'PRODUCT_MISMATCH'; end if;
  if v_ic is null then raise exception 'COUNTRY_MISMATCH'; end if;
  if v_oc is not null and v_oc <> v_ic then raise exception 'COUNTRY_MISMATCH'; end if;
  if v_ocal is not null
     and (v_ical is null or v_ocal <> v_ical)
     and not coalesce(p_allow_caliber_mismatch, false) then
    raise exception 'CALIBER_MISMATCH';
  end if;

  select coalesce(sum(di.pallets), 0) into v_distribution_used
    from public.distribution_items di where di.shipment_item_id = v_item.id;

  select coalesce(sum(ap.pallets), 0) into v_allocation_used
    from public.manager_offer_allocation_parts ap
   where ap.shipment_item_id = v_item.id and ap.status = 'ordered';

  v_free_capacity := coalesce(v_item.pallet_count, 0)
                   - greatest(v_distribution_used, v_allocation_used);

  if v_free_capacity <= 0 then raise exception 'OVER_CAPACITY'; end if;

  if p_max_pallets is null then
    v_budget := v_free_capacity;
  elsif p_max_pallets <= 0 then
    raise exception 'INVALID_PALLETS';
  else
    v_budget := least(p_max_pallets, v_free_capacity);
  end if;

  for r_resp in
    select id, branch_id, offer_id, approved_pallets
      from public.manager_offer_responses
     where offer_id = p_offer_id
       and coalesce(approved_pallets, 0) > 0
     order by created_at asc, id asc
     for update
  loop
    exit when v_budget <= 0;

    if r_resp.offer_id <> p_offer_id then
      continue;
    end if;

    v_approved := coalesce(r_resp.approved_pallets, 0);

    select coalesce(sum(pallets),0) into v_ordered
      from public.manager_offer_allocation_parts
     where response_id = r_resp.id and status = 'ordered';

    select coalesce(sum(pallets),0) into v_cancelled
      from public.manager_offer_allocation_parts
     where response_id = r_resp.id and status = 'cancelled';

    v_remaining := v_approved - v_ordered - v_cancelled;
    if v_remaining <= 0 then continue; end if;

    v_take := least(v_remaining, v_budget);

    insert into public.manager_offer_allocation_parts (
      offer_id, response_id, branch_id,
      shipment_id, shipment_item_id,
      pallets, status, notes, created_by
    ) values (
      p_offer_id, r_resp.id, r_resp.branch_id,
      v_item.shipment_id, v_item.id,
      v_take, 'ordered', p_notes, v_uid
    )
    returning * into v_part;

    v_inserted_any := true;
    return next v_part;
    v_budget := v_budget - v_take;
  end loop;

  if not v_inserted_any then
    raise exception 'NOTHING_TO_ALLOCATE';
  end if;

  -- Patch 1D: sync distribution after successful FIFO loop (only when at least one insert happened).
  perform public.sync_manager_offer_distribution(p_offer_id);

  return;
end;
$function$;
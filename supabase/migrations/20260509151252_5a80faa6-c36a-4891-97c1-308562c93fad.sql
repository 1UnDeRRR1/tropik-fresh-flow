
-- Apply transfer of pallets between branches when offer is accepted
create or replace function public.apply_branch_transfer_offer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  src_di_id uuid;
  src_qty numeric;
  src_pallets numeric;
  src_unit_cost numeric;
  move_pallets numeric;
  move_qty numeric;
  ship_id uuid;
  dst_dist_id uuid;
  dst_di_id uuid;
begin
  if (tg_op = 'UPDATE')
     and new.status in ('accepted','partially_accepted')
     and old.status = 'pending'
     and coalesce(new.accepted_pallets,0) > 0 then

    select shipment_id into ship_id from public.shipment_items where id = new.shipment_item_id;

    select di.id, coalesce(di.qty,0), coalesce(di.pallets,0), coalesce(di.unit_cost,0)
      into src_di_id, src_qty, src_pallets, src_unit_cost
      from public.distribution_items di
      join public.distributions d on d.id = di.distribution_id
     where di.shipment_item_id = new.shipment_item_id
       and d.branch_id = new.from_branch_id
       and d.id = new.distribution_id
     limit 1;

    if src_di_id is null then
      raise exception 'Не знайдено позицію філії-відправника для переказу';
    end if;

    move_pallets := new.accepted_pallets;
    if src_pallets > 0 then
      move_qty := round((src_qty * move_pallets / src_pallets)::numeric, 3);
    else
      move_qty := 0;
    end if;

    update public.distribution_items
       set pallets = greatest(0, src_pallets - move_pallets),
           qty = greatest(0, src_qty - move_qty)
     where id = src_di_id;

    select id into dst_dist_id
      from public.distributions
     where shipment_id = ship_id
       and branch_id = new.to_branch_id
     limit 1;

    if dst_dist_id is null then
      insert into public.distributions(shipment_id, branch_id, status, notes)
      values (ship_id, new.to_branch_id, 'planned', 'Переказ між філіями')
      returning id into dst_dist_id;
    end if;

    select id into dst_di_id
      from public.distribution_items
     where distribution_id = dst_dist_id
       and shipment_item_id = new.shipment_item_id
     limit 1;

    if dst_di_id is null then
      insert into public.distribution_items(distribution_id, shipment_item_id, pallets, qty, unit_cost)
      values (dst_dist_id, new.shipment_item_id, move_pallets, move_qty, src_unit_cost);
    else
      update public.distribution_items
         set pallets = coalesce(pallets,0) + move_pallets,
             qty = coalesce(qty,0) + move_qty
       where id = dst_di_id;
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists trg_apply_branch_transfer_offer on public.branch_transfer_offers;
create trigger trg_apply_branch_transfer_offer
after update on public.branch_transfer_offers
for each row execute function public.apply_branch_transfer_offer();

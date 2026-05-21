-- Patch 1A: manager_offer_allocation_parts (DDL + RLS read-only)

create table public.manager_offer_allocation_parts (
  id               uuid primary key default gen_random_uuid(),
  offer_id         uuid not null,
  response_id      uuid not null,
  branch_id        uuid not null,
  pallets          numeric not null,
  shipment_id      uuid,
  shipment_item_id uuid,
  status           text not null default 'ordered',
  source           text not null default 'link',
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint moap_offer_fk         foreign key (offer_id)         references public.manager_offers(id)            on delete cascade,
  constraint moap_response_fk      foreign key (response_id)      references public.manager_offer_responses(id)   on delete cascade,
  constraint moap_branch_fk        foreign key (branch_id)        references public.branches(id)                  on delete restrict,
  constraint moap_shipment_fk      foreign key (shipment_id)      references public.shipments(id)                 on delete set null,
  constraint moap_shipment_item_fk foreign key (shipment_item_id) references public.shipment_items(id)            on delete set null,

  constraint moap_pallets_positive check (pallets > 0),
  constraint moap_status_valid     check (status in ('ordered','cancelled')),
  constraint moap_source_valid     check (source in ('link','topup','new_shipment','backfill'))
);

create index moap_offer_idx          on public.manager_offer_allocation_parts(offer_id);
create index moap_response_idx       on public.manager_offer_allocation_parts(response_id);
create index moap_branch_idx         on public.manager_offer_allocation_parts(branch_id);
create index moap_shipment_item_idx  on public.manager_offer_allocation_parts(shipment_item_id);
create index moap_shipment_idx       on public.manager_offer_allocation_parts(shipment_id);
create index moap_status_idx         on public.manager_offer_allocation_parts(status);

create trigger moap_set_updated_at
before update on public.manager_offer_allocation_parts
for each row execute function public.update_updated_at_column();

alter table public.manager_offer_allocation_parts enable row level security;

-- Admin: full access
create policy "moap admin all"
on public.manager_offer_allocation_parts
for all
to authenticated
using (is_admin(auth.uid()))
with check (is_admin(auth.uid()));

-- Offer owner: read parts of their offers
create policy "moap owner read"
on public.manager_offer_allocation_parts
for select
to authenticated
using (owns_manager_offer(offer_id, auth.uid()));

-- Branch users: read parts for their branch
create policy "moap branch read"
on public.manager_offer_allocation_parts
for select
to authenticated
using (branch_id = user_branch_id(auth.uid()));

-- Staff: read all
create policy "moap staff read"
on public.manager_offer_allocation_parts
for select
to authenticated
using (is_staff(auth.uid()));

-- Shipment owner: read parts linked to their shipment items
create policy "moap shipment owner read"
on public.manager_offer_allocation_parts
for select
to authenticated
using (
  shipment_item_id is not null
  and exists (
    select 1 from public.shipment_items si
    where si.id = manager_offer_allocation_parts.shipment_item_id
      and is_shipment_owner(si.shipment_id, auth.uid())
  )
);
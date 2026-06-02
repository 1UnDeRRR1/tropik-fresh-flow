# 01 — Architecture

## Core principle: `position_id` is the lifecycle anchor

The **product position** (identified by `position_id`) is the single operational anchor for the entire lifecycle. Everything else attaches around it:

- Supplier **offers** attach to a position.
- **Shipments** and shipment items attach to positions.
- **Branch allocations** and distributions attach to positions.
- **Cost** (purchase, customs, transport, FX, internal) rolls up per position.
- **Logistics** events (loading, vehicle, route, ETA) attach to positions via shipment items.
- **Statuses** (pipeline, customs, distribution) are observed per position.
- **Transfers** between branches reference positions.
- **Documents** (invoices, CMR, customs papers) attach via shipments/positions.

## What `position_id` is NOT
- It is **not** a synonym for `shipment_item_id`, `offer_id`, `branch_request_id`, or `supplier_id`.
- It is **not** derived from supplier or branch identity.
- It is **not** minted by UI flows that lack a confirmed product anchor.

## Forbidden architectural drifts
Do **not** revert the model toward any of these legacy shapes:

- **Shipment-centered**: treating a shipment row as the primary entity and positions as children of shipments only.
- **Offer-centered**: treating an offer as the primary entity and creating "ghost" positions per offer.
- **Branch-centered**: creating a separate product identity per branch request.
- **Supplier-centered**: collapsing identity around supplier.

These shapes have all been tried and rejected. Re-introducing them breaks cost roll-up, RLS, and distribution.

## Country concepts — keep separate
There are **four** distinct country concepts. Never collapse or fallback between them:

1. **origin_country** — product origin only.
2. **supplier_country** — supplier's legal country.
3. **loading_country** — where the truck was loaded.
4. **shipment/vehicle_country** — vehicle registration / shipment routing country.

## Data ownership boundary
- **Reference / master data** (products, countries, aliases, suppliers, managers, branches, pallet standards, customs/transport/FX tables) is protected. Changes require explicit approval.
- **Operational rows** (shipments, positions, offers, requests, allocations, pallets, logistics, cost rows) are mutable per approved tasks.

## Server-side
- App-internal server logic: TanStack `createServerFn` with `requireSupabaseAuth`.
- Webhooks / cron: `src/routes/api/public/*` with explicit signature or `CRON_SECRET` verification.
- Supabase Edge Functions are **not** the default; inherited ones remain only where required.

## RLS posture
- Every public-schema table has explicit `GRANT`s and RLS policies.
- Roles live in a separate `user_roles` table, checked via `SECURITY DEFINER` `has_role()`.
- Branch-safe data is exposed through `SECURITY DEFINER` views (`shipments_branch`, `shipment_items_branch`) with column whitelists, not by widening raw-table RLS.

# 03 — Current State

> Update this file after every accepted important change. It is the first thing a new session should read.

## Project
**Tropik Fresh Flow** — mobile-first PWA for fresh-produce import management.

## Current source-of-truth principle
- `position_id` is the single product-lifecycle anchor.
- Offers, shipments, branch allocations, costs, logistics, statuses, transfers, and documents attach around the product position.
- Branch data is exposed through `SECURITY DEFINER` views (`shipments_branch`, `shipment_items_branch`) with column whitelists.

## Tropik Archive — accepted state (S1.1 → S3 first slice)

**Direction:** Snapshot-first / "super archive". PBA-first is stopped. Legacy `branch_archive_events` / `bae_*` are NOT restored. Raw archive tables are closed to `anon` / `authenticated`; role-safe views remain the only access surface.

**S1.1 — schema:**
- `archive_snapshot_source` includes `branch_stock_request`.
- `manager_distribution` does NOT create a snapshot.
- One snapshot can produce multiple `branch_archive_results` rows.
- `event_qty` column added.
- `requested_sale_price_snapshot` / `requested_sale_currency_snapshot` added.
- `requested_qty > 0` CHECK exists as `NOT VALID` (validation deferred).

**S2 — snapshot writers:**
- `branch_response` snapshot from `manager_offer_responses`.
- `branch_stock_request` snapshot from `branch_requests` where `request_type='free_offer'`.
- Refused = immediate: `branch_response` via `refused_at`/`refused_by`; `branch_stock_request` via `status='rejected'`.
- 0 pallets is NOT refusal. `approved_pallets=0` / `approved_qty=0` is NOT refusal.
- UI patch removed the "0-as-refusal" interpretation.
- `cancelled` source deferred.

**S3 first slice — resolver:**
- `public.archive_resolver_run(p_run_date, p_snapshot_id)` — manual, `SECURITY DEFINER`, `search_path=public`, `EXECUTE` only to `service_role`.
- Partial unique indexes on `branch_archive_results`: `bar_unique_per_snapshot_no_shipment`, `bar_unique_per_snapshot_shipment` (idempotency).
- `branch_response`: `not_fulfilled` slice works; delivered/cut logic implemented but end-to-end QA still pending.
- `branch_stock_request`: delivered/cut via `approved_qty` smoke-passed.
- `not_fulfilled` writes `event_qty` and `actual_eta` (from `v_live_eta`).
- `delivered` writes `delivered_qty` / `event_qty` / `cut_qty`.
- Split / transfer / reallocation-to-0 / direct `manager_distribution` surface / cancelled — all DEFERRED.
- No cron. No archive UI. No link-RPC changes.

## Critical current risks
- **Live-JWT QA of Tropik Archive role-safe views** not yet performed — gates Tropik Archive UI and pilot.
- **S3 `branch_response` delivered/cut end-to-end smoke** still desirable.
- **Split shipment resolver** not implemented.
- **Transfer/share investigation detail** not implemented.
- **Reallocation-to-0 detail** not implemented.
- **Cancelled** requires an explicit safe position-cancel source before resolver coverage.
- **Direct `manager_distribution` visible surface** deferred.
- **Cron/scheduler** deferred — resolver is manual `service_role` only.
- **Archive UI** deferred.
- **`NOT VALID` constraints** on archive tables remain unvalidated; validate only after explicit decision.
- **Raw branch RLS policies on `shipments` / `shipment_items`** still in place as a safety net (Stage 1B not yet executed).
- **Cost / customs / transport / FX formulas** are fragile — any change requires Plan/Preview.
- **`position_id` lifecycle** must remain the only product anchor — see `/docs/01_ARCHITECTURE.md`.
- **Lovable rollback does not roll back Supabase artifacts** (migrations, RLS, data). Code revert ≠ DB revert.

## Recently closed
- Tropik Archive S3 first-slice resolver + `actual_eta` hotfix + ambiguous-`snapshot_id` hotfix — smoke-passed.
- Tropik Archive S2 Wave 1 + UI patch + Wave 2 snapshot writers — accepted, smoke-passed.
- Tropik Archive S1.1 schema (event_qty, requested_sale_*_snapshot, branch_stock_request source, multi-row per snapshot).
- Security Finding #5 — anon/PUBLIC `EXECUTE` removed from 4 activity RPCs.
- Security Finding #1 Stage 1A — branch-safe views created, branch UI switched to them; raw policies kept as safety net.

## Update protocol
Whenever an accepted change touches DB, RLS, auth, roles, formulas, or `position_id`:
1. Append an entry to `/docs/04_PROJECT_LOG.md`.
2. Update this file's "Current source-of-truth", "Critical current risks", and "Recently closed" sections.
3. Update `/docs/06_NEXT_ACTIONS.md` if it changes the next safe step.

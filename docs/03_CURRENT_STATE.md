# 03 — Current State

> Update this file after every accepted important change. It is the first thing a new session should read.

## Project
**Tropik Fresh Flow** — mobile-first PWA for fresh-produce import management.

## Current source-of-truth principle
- `position_id` is the single product-lifecycle anchor.
- Offers, shipments, branch allocations, costs, logistics, statuses, transfers, and documents attach around the product position.
- Branch data is exposed through `SECURITY DEFINER` views (`shipments_branch`, `shipment_items_branch`) with column whitelists.

## Critical current risks
- **Raw branch RLS policies on `shipments` / `shipment_items` are still in place** as a safety net (Stage 1B not yet executed). Branch users currently rely on branch-safe views in UI; raw policies remain for fallback.
- **Cost / customs / transport / FX formulas** are fragile — any change requires Plan/Preview.
- **`position_id` lifecycle** must remain the only product anchor — see `/docs/01_ARCHITECTURE.md`.
- **Lovable rollback does not roll back Supabase artifacts** (migrations, RLS, data). Code revert ≠ DB revert.

## Recently closed
- Security Finding #5 — anon/PUBLIC `EXECUTE` removed from 4 activity RPCs.
- Security Finding #1 Stage 1A — branch-safe views created, branch UI switched to them; raw policies kept as safety net.

## Update protocol
Whenever an accepted change touches DB, RLS, auth, roles, formulas, or `position_id`:
1. Append an entry to `/docs/04_PROJECT_LOG.md`.
2. Update this file's "Current source-of-truth", "Critical current risks", and "Recently closed" sections.
3. Update `/docs/06_NEXT_ACTIONS.md` if it changes the next safe step.

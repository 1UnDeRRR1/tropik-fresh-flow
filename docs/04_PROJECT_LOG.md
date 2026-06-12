# 04 — Project Log

Append-only chronological log of accepted/rejected tasks. Newest at the top.

## Template

```
### YYYY-MM-DD — <short task title>
- Branch:
- Task:
- Status: accepted | rejected | partially accepted
- Changed files:
- DB touched: yes/no — details
- RLS touched: yes/no — details
- Auth touched: yes/no — details
- Checks: typecheck / build / smoke / manual
- Notes / risks:
- Next step:
```

---

## Entries

### 2026-06-12 — Tropik Archive S3 first-slice resolver + hotfixes
- Branch: main
- Task: Build S3 first-slice resolver `public.archive_resolver_run(p_run_date, p_snapshot_id)` (manual, service_role only), with partial unique indexes on `branch_archive_results` for idempotency. Two hotfixes followed: (a) ambiguous `snapshot_id` in `ON CONFLICT` resolved by switching to `ON CONFLICT DO NOTHING` relying on the partial indexes; (b) `branch_response` `not_fulfilled` path now writes `actual_eta = v_live_eta` instead of hardcoded `NULL`.
- Status: accepted (first slice; split/transfer/reallocation-to-0/cancelled/direct-MD deferred)
- Changed files: `supabase/migrations/20260612081503_*.sql`, `supabase/migrations/20260612083520_*.sql`, `supabase/migrations/20260612085439_*.sql`, `supabase/migrations/20260612085616_*.sql` (smoke-row cleanup), `src/integrations/supabase/types.ts` (regenerated)
- DB touched: yes — two partial unique indexes on `branch_archive_results`; created/updated `archive_resolver_run` function; disposable smoke rows inserted and cleaned up
- RLS touched: no
- Auth touched: no
- Checks: smoke — `not_fulfilled` writes `event_qty` + `actual_eta`; delivered/cut via `approved_qty` on `branch_stock_request` smoke-passed; idempotency on rerun confirmed; `anon`/`authenticated` cannot EXECUTE
- Notes / risks: `branch_response` delivered/cut end-to-end smoke still desirable; split/transfer/reallocation-to-0/cancelled/direct `manager_distribution` deferred; no cron; no archive UI; `NOT VALID` CHECKs remain unvalidated
- Next step: Live-JWT QA of role-safe archive views, then Archive UI Plan

### 2026-06-XX — Tropik Archive S2 Wave 1 + UI patch + Wave 2 (snapshot writers)
- Branch: main
- Task: Snapshot writers for `branch_response` (from `manager_offer_responses`) and `branch_stock_request` (from `branch_requests` where `request_type='free_offer'`). Immediate-refused recorded via `refused_at`/`refused_by` (branch_response) and `status='rejected'` (branch_stock_request). UI patch removed the "0-as-refusal" interpretation: `0 pallets`, `approved_pallets=0`, `approved_qty=0` are NOT refusal.
- Status: accepted; `cancelled` source deferred
- DB touched: yes — snapshot writer functions/triggers per accepted plan
- RLS touched: no — raw archive tables remain closed to anon/authenticated; role-safe views are the only access surface
- Auth touched: no
- Checks: S2 targeted smoke passed
- Notes / risks: cancelled-source requires explicit safe position-cancel design before resolver coverage

### 2026-06-XX — Tropik Archive S1.1 schema
- Branch: main
- Task: `archive_snapshot_source` includes `branch_stock_request`; `manager_distribution` does NOT create a snapshot; one snapshot can produce multiple `branch_archive_results` rows; added `event_qty`, `requested_sale_price_snapshot`, `requested_sale_currency_snapshot`; `requested_qty > 0` CHECK added as `NOT VALID`.
- Status: accepted
- DB touched: yes — schema additions only; no backfill, no validation of NOT VALID CHECK
- RLS touched: no
- Auth touched: no
- Notes / risks: validate NOT VALID CHECK only after explicit decision

### Direction note — Tropik Archive
- Snapshot-first / "super archive" is the accepted direction.
- PBA-first is stopped.
- Legacy `branch_archive_events` / `bae_*` are NOT restored.
- Raw archive tables stay closed to `anon` / `authenticated`; role-safe views are the access surface.

- Branch: main
- Task: Narrow cosmetic/layout fix of Owner Analytics Level 2 product-detail modal card (duplicated inner title, focus ring, compact date tile, fixed-zone layout).
- Status: rejected (rolled back)
- Changed files: `src/routes/_authenticated/analytics.tsx` (restored to base commit `b1495748`); no other files
- DB touched: no
- RLS touched: no
- Auth touched: no
- Checks: typecheck passed; `git diff b1495748 -- src/routes/_authenticated/analytics.tsx` = 0 lines; `routeTree.gen.ts` unchanged
- Notes / risks: Repeated narrow patches entered a failed loop with scope creep (unapproved side-effects on Level 3 modal, DialogTitle separator, extra labels). Decision: full rollback of `analytics.tsx` only to last stable state, per user Option 3. No accepted changes from this modal task remain. Non-critical cosmetic task — not worth continuing the patch loop.
- Next step: see `docs/06_NEXT_ACTIONS.md` — any future revisit starts as a fresh Plan/Preview, not a continuation.

### 2026-06-02 — Project memory docs scaffold

- Branch: main
- Task: Create `/AGENTS.md` and `/docs/00..09_*.md` as persistent project memory.
- Status: accepted
- Changed files: `AGENTS.md`, `docs/00_PROJECT_BRIEF.md` … `docs/09_BRANCH_HANDOFF_TEMPLATE.md`
- DB touched: no
- RLS touched: no
- Auth touched: no
- Checks: docs-only, no code
- Notes / risks: none
- Next step: populate `/docs/03_CURRENT_STATE.md` and `/docs/06_NEXT_ACTIONS.md` from real chat history as decisions land.

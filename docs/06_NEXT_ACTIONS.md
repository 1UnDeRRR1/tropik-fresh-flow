# 06 — Next Actions

> Single source of truth for what is in flight, what is next, and what is parked.

## Active request
_(none — Tropik Archive S3 first-slice closed; awaiting next direction)_

- Title:
- Mode: Plan | Preview | Build | Apply | Audit | QA
- Owner:
- Scope:
- Acceptance criteria:

## Next safe action
**Live-JWT QA of role-safe archive views** (mode: QA, read-only). Validate that each role (super_admin, admin, import_manager, branch, logistics, broker) sees only the columns/rows the role-safe archive views expose, using real JWTs — not service-role. This gates the Archive UI plan.

After QA passes:
- **Archive UI Plan** (mode: Plan) — read-only archive surface backed by role-safe views.

Other candidates (do NOT start without explicit approval):
- **S3.2 Plan** — split / transfer / reallocation-to-0 / detail-table design.
- **Cron/scheduler Plan** — only after resolver QA fully accepted.
- Security Finding #1 — Stage 1B: drop raw branch RLS policies on `shipments` / `shipment_items` after successful manual smoke-test of Stage 1A.

## Backlog — P2 (important, not urgent)
- S3 `branch_response` delivered/cut end-to-end smoke (fixture-based).
- Validate `NOT VALID` CHECK on `branch_archive_results.requested_qty > 0` (requires explicit decision and backfill audit).
- Cancelled-source design: explicit safe position-cancel source before resolver coverage.
- Direct `manager_distribution` visible surface design.

## Polish — P3 (nice to have)
- Owner Analytics Level 2 product-detail modal — cosmetic/layout revisit. Previous attempt (2026-06-03) was rolled back to base commit `b1495748` after a failed patch loop. Any future attempt MUST start as a fresh Plan/Preview task: (1) exact audit of existing layout in `src/routes/_authenticated/analytics.tsx`, (2) minimal visual plan with explicit allowed-change list, (3) Build only after approval. Do NOT continue as patches on top of the previous failed series. Not an active task.

## Blocked / waiting on developer response
- (empty — add as items appear)

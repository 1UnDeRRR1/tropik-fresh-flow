# 06 — Next Actions

> Single source of truth for what is in flight, what is next, and what is parked.

## Active request
_(fill in the one currently in flight)_

- Title:
- Mode: Plan | Preview | Build | Apply | Audit | QA
- Owner:
- Scope:
- Acceptance criteria:

## Next safe action
_(the immediately next step once the active request closes)_

- Security Finding #1 — Stage 1B: drop raw branch RLS policies on `shipments` and `shipment_items` after successful manual smoke-test of Stage 1A.

## Backlog — P2 (important, not urgent)
- (empty — add as items appear)

## Polish — P3 (nice to have)
- Owner Analytics Level 2 product-detail modal — cosmetic/layout revisit. Previous attempt (2026-06-03) was rolled back to base commit `b1495748` after a failed patch loop. Any future attempt MUST start as a fresh Plan/Preview task: (1) exact audit of existing layout in `src/routes/_authenticated/analytics.tsx`, (2) minimal visual plan with explicit allowed-change list, (3) Build only after approval. Do NOT continue as patches on top of the previous failed series. Not an active task.

- (empty — add as items appear)

## Blocked / waiting on developer response
- (empty — add as items appear)

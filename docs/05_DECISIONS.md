# 05 — Accepted Workflow Decisions

These are workflow rules the team has accepted. They are binding until explicitly revised here.

1. **One active developer request at a time.** No parallel unrelated tasks in flight.
2. **Developer-facing prompts must stay focused and scoped.** Mixed-scope prompts are rejected before any code is written.
3. **Risky tasks require Plan / Preview first.** Risky = DB, RLS, auth, roles, cost formulas, `position_id` lifecycle, cron, scheduled jobs, reserved schemas.
4. **Build / Apply implements only the accepted scope.** No unrelated refactors, no opportunistic UI changes.
5. **Minor polish can be backlogged.** If it is not blocking, it goes to `/docs/06_NEXT_ACTIONS.md` under P3, not into the current task.
6. **GitHub docs are the external project memory.** `/AGENTS.md` and `/docs/*` are authoritative across sessions and agents.
7. **Lovable rollback does not roll back Supabase.** Treat DB changes as forward-only unless an explicit reverse migration is written.
8. **Branch / logistics / broker data is sensitive by default.** Expansions of their visibility require Plan/Preview and a security review.
9. **`position_id` is the only product anchor.** Decisions that re-introduce shipment-, offer-, supplier-, or branch-centered identity are rejected by default.

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
10. **Malekhiv Archive direction is snapshot-first / "super archive".** PBA-first is stopped. Legacy `branch_archive_events` / `bae_*` are NOT to be restored. Raw archive tables remain closed to `anon` / `authenticated`; role-safe views are the sole access surface. `manager_distribution` does NOT create snapshots. One snapshot may produce multiple `branch_archive_results` rows.
11. **Refusal semantics in Malekhiv Archive.** Refused = immediate, recorded via `branch_response.refused_at`/`refused_by` or `branch_stock_request.status='rejected'`. `0 pallets`, `approved_pallets=0`, and `approved_qty=0` are NOT refusal. UI must not treat `0` as refusal.
12. **S3 archive resolver is manual / `service_role`-only.** `public.archive_resolver_run(p_run_date, p_snapshot_id)` is `SECURITY DEFINER`, `search_path=public`, `EXECUTE` restricted to `service_role`. No cron, no archive UI, no link-RPC changes in the first slice. Split / transfer / reallocation-to-0 / cancelled / direct `manager_distribution` surface are deferred.

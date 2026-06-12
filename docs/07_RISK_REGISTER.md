# 07 — Risk Register

Living list of structural risks. Each section captures the risk and the current mitigation.

## Auth / RLS / role visibility
- Risk: misconfigured RLS or GRANTs expose sensitive data (supplier, purchase, FX, internal cost) to branch/logistics/broker roles, or break authenticated heartbeat.
- Mitigation: branch-safe `SECURITY DEFINER` views with column whitelists; role checks via `has_role()`; Plan/Preview required for any change.

## Supabase migrations
- Risk: forward-only migrations cannot be undone by a Lovable code revert.
- Mitigation: Plan/Preview before Apply; explicit reverse migration when feasible; log every migration in `/docs/04_PROJECT_LOG.md`.

## `position_id` lifecycle
- Risk: drift back to shipment-/offer-/supplier-/branch-centered identity; minting positions from legacy IDs.
- Mitigation: architectural rule in `/docs/01_ARCHITECTURE.md`; RPCs operate on `position_id`; reject PRs that mint identity from legacy IDs.

## Cost / customs / transport formulas
- Risk: silent change in roll-up logic causing wrong internal cost.
- Mitigation: any formula change requires Plan/Preview and explicit acceptance tests.

## Net / gross / pallet logic
- Risk: confusion between net weight, gross weight, pallet weight, and pallet count breaks loading plans and distribution.
- Mitigation: keep canonical conversions in `src/lib/`; do not duplicate formulas inline in components.

## Branch / logistics / broker data visibility
- Risk: convenience features leak supplier, purchase, FX, customs, or transport fields to non-staff roles.
- Mitigation: branch-safe views and column whitelists; column audit before any UI change in branch/logistics/broker screens.

## Lovable rollback ≠ Supabase rollback
- Risk: reverting code in Lovable leaves DB schema, RLS, triggers, and data ahead of the code.
- Mitigation: keep `/docs/04_PROJECT_LOG.md` accurate; never rely on code revert to undo DB changes; write reverse migrations when destructive.

## Activity / heartbeat / stale sessions
- Risk: hardening RPC grants breaks heartbeat or super_admin activity view.
- Mitigation: `EXECUTE` granted only to `authenticated` and `service_role`; smoke-test heartbeat + super_admin activity after any change.

## Tropik Archive — resolver & snapshot integrity
- Risk: resolver writes duplicates, misclassifies refusal, or leaks raw archive rows to non-staff roles; deferred surfaces (split / transfer / reallocation-to-0 / cancelled / direct `manager_distribution`) get added ad-hoc and bypass snapshot-first design.
- Mitigation: partial unique indexes (`bar_unique_per_snapshot_no_shipment`, `bar_unique_per_snapshot_shipment`) enforce idempotency; resolver is `service_role`-only with no cron/UI; raw archive tables closed to `anon`/`authenticated`; role-safe views are the only access surface; deferred surfaces require explicit Plan/Preview before any code or SQL.

## Tropik Archive — role-safe view exposure
- Risk: role-safe archive views expose more columns or rows than intended under real (non-service-role) JWTs.
- Mitigation: Live-JWT QA across all roles is the gate before any Archive UI Plan or pilot.

## Tropik Archive — NOT VALID CHECKs
- Risk: `requested_qty > 0` and similar `NOT VALID` constraints get validated prematurely and fail on legacy rows.
- Mitigation: do not `VALIDATE CONSTRAINT` without an explicit decision and a backfill audit.

# AGENTS.md — Rules for AI Agents and Developers

This file governs how AI agents (ChatGPT, Lovable, Claude, etc.) and human developers work on **Tropik Fresh Flow**. It is the entry point for any new session and must be respected before any code or DB change.

---

## 1. One active request at a time

- Only **one** active developer/Lovable request may be in flight at any moment.
- Do **not** start a new unrelated task until the previous one is reviewed, accepted, and closed.
- If a new urgent task appears, explicitly pause the current one and record the pause in `/docs/04_PROJECT_LOG.md`.

## 2. Task modes — keep them separate

Every request must be classified into one of the following modes. Do not mix them in a single turn:

- **Plan** — analysis, options, risks. No code, no SQL, no migrations.
- **Preview** — concrete diff/SQL preview. Still no apply.
- **Build** — implement only the previously accepted Plan/Preview scope.
- **Apply** — execute previously approved migrations or destructive ops.
- **Audit** — read-only inspection of code, DB, RLS, roles.
- **QA** — smoke tests against an existing build, no new code.

## 3. Risky areas always require Plan / Preview first

The following areas are **never** modified directly without an accepted Plan/Preview:

- Supabase schema, migrations, triggers, functions
- RLS policies and `GRANT` / `REVOKE`
- Auth (signup, login, email confirm, social providers)
- Roles and role visibility (`super_admin`, `admin`, `import_manager`, `branch`, `logistics`, `broker`)
- Cost / customs / transport / FX formulas
- `position_id` lifecycle and product-position anchoring
- Net / gross / pallet logic
- Cron / `CRON_SECRET` / scheduled jobs
- Branch / logistics / broker data visibility

## 4. Build / Apply scope discipline

When in **Build** or **Apply** mode:

- Implement **only** the accepted scope.
- Do **not** refactor unrelated files.
- Do **not** redesign UI, forms, tables, scroll behavior, or navigation unless explicitly requested.
- Do **not** rename variables, columns, routes, or components on sight.
- Do **not** "fix" adjacent code that is out of scope, even if it looks wrong — file a note in `/docs/06_NEXT_ACTIONS.md` instead.
- Do **not** delete operational data unless the task explicitly authorizes it.

## 5. Mandatory implementation report

Every Build/Apply turn must end with a report containing:

- **Changed files** (full list)
- **DB touched?** yes/no — what
- **RLS touched?** yes/no — what
- **Auth touched?** yes/no — what
- **Checks / tests run** (typecheck, build, smoke, manual)
- **Remaining risks**
- **Next safe step**

If any of these are unknown, say so explicitly. Do not omit fields.

## 6. Stop conditions

Stop and ask before continuing if:

- The task would expand outside the accepted scope.
- A change risks breaking auth, heartbeat, login, role visibility, or `position_id` lifecycle.
- A migration would touch reserved schemas (`auth`, `storage`, `realtime`, `supabase_functions`, `vault`).
- A change would require dropping/altering RLS that protects branch/logistics/broker data.

## 7. Memory and handoff

- `/docs/` in this repo is the **external project memory**. Update it after every accepted important change.
- When switching branches or agents, fill `/docs/09_BRANCH_HANDOFF_TEMPLATE.md`.
- Do not rely on chat history alone — always re-read `/docs/03_CURRENT_STATE.md` and `/docs/06_NEXT_ACTIONS.md` at the start of a session.

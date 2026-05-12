# Lightweight Calendar Access System

Two new read-only calendar modes plus a Calendar Access Management panel for admins. Company name is **Tropik** everywhere.

## 1. New roles & data

New `app_role` values:
- `calendar_branch` — sees only assigned branch
- `calendar_tropik` — sees global Tropik calendar

New table `public.calendar_accounts`:
- `id`, `user_id` (auth.users), `username`, `access_type` ('branch' | 'tropik')
- `branch_id` (nullable, required when type=branch)
- `valid_from` date, `valid_until` date (nullable = unlimited), `is_active` bool
- `created_by`, `created_at`, `notes`
- Unique `username`

Helper SQL (security definer):
- `is_calendar_active(_user_id)` — true if account row is active and within valid window
- `user_calendar_branch(_user_id)` — branch_id

RLS: only admin/super_admin manage rows; users can read their own row. `is_staff()` is **not** changed — calendar users must NOT pass staff checks.

Login is by username; auth uses synthetic email `username@calendar.tropik.local`.

## 2. Account creation flow (admin)

New page `/admin/calendar-access`:
- Choose access type (Branch / Tropik)
- If Branch → pick branch from `branches`
- Username auto-generated:
  - Branch: `{BranchCode or Slug}-{nextSeq}` e.g. `Odesa-8`
  - Tropik: `Tropik-{nextSeq}`
- Password auto-generated (12 chars, copyable, shown once)
- Duration: One-time / N days / Custom date range / Permanent
- Save → calls edge function `calendar-account-admin` (service role):
  1. Creates auth user (synthetic email + password)
  2. Inserts into `calendar_accounts`
  3. Inserts into `user_roles` with the matching calendar role
  4. Returns username/password to admin once

List below: existing accounts with status (active / expired / disabled) and revoke / extend / regenerate actions.

## 3. Login

Login page accepts username or email. If input has no `@`, it's converted to `username@calendar.tropik.local`. After sign-in, role-based redirect:
- `calendar_branch` → `/calendar/branch`
- `calendar_tropik` → `/calendar/tropik`
- existing roles → unchanged

A login-time check rejects expired accounts via `is_calendar_active` and signs out with a clear message.

## 4. Branch calendar view (`/calendar/branch`)

Read-only, mobile-first list grouped by ETA date, only the user's own branch.

Per row:
- ETA, product, pallets allocated to this branch
- Branch-visible price (uses existing `shipment_items_branch` view — purchase price excluded)
- Shipment status chip
- Responsible import manager

Data: existing branch views joined to `distributions` filtered by `user_branch_id(auth.uid())`. SELECT policy on `distributions` mirrors branch user's policy for `calendar_branch`.

No nav, no AppShell modules — header (logo + branch name + logout) only.

## 5. Tropik calendar view (`/calendar/tropik`)

Read-only aggregated dashboard for `calendar_tropik`.

Top: aggregated rows per `product_name` across active shipments (status not in cancelled/completed):
- Product, total pallets, shipment count
- Sorted by pallets desc

Click row → expands to shipment-level list:
- ETA, pallets, status, responsible import manager
- Indicative/invoice cost (already in `active_shipments_overview`)
- Category if available

New SECURITY DEFINER RPCs:
- `tropik_calendar_aggregate()` → product, total_pallets, shipment_count
- `tropik_calendar_shipments(_product text)` → shipment-level rows

Both check `has_role(auth.uid(), 'calendar_tropik') OR is_staff(auth.uid())`. Return empty when account inactive.

No branch-level breakdown anywhere on this page.

## 6. Layout

Minimal `_calendar` layout route (parallel to `_authenticated`) without operational nav, bottom tab bar, or admin chrome — just header + content + logout.

`AuthenticatedLayout` redirects calendar users away from operational routes to their calendar.

## 7. Expiry enforcement

- Server: `is_calendar_active` checked in RLS reads and in the two RPCs.
- Edge function `calendar-expiry-sweep` (cron-callable) flips `is_active=false` and disables the auth user when `valid_until < now()`.
- Client: re-check active status on login and every 5 min while in calendar shell; if false → sign out with "Доступ завершено".

## 8. Out of scope

- No operational editing
- No admin/master-data access for calendar users
- No supplier/shipment editing
- No branch breakdown on Tropik calendar
- No PWA/offline changes

## Technical notes

- Schema via `supabase--migration` (extend `app_role` enum, new table, RPCs, policies).
- Account creation via edge function so the service role never reaches the client.
- Synthetic email domain `@calendar.tropik.local` keeps real emails free.
- Username unique at DB level.
- All new pages responsive, no AppShell.

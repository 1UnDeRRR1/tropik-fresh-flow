## Goal

Scope all import-manager data access to their own records — at both the database (RLS) and UI (queries) layers. Admins/super_admins keep full access. Branches keep current branch-scoped access.

## Ownership model

- **Shipment ownership** = `shipments.import_manager_id` mapped to a user via a new lookup, OR `shipments.created_by` if `import_manager_id` is null. To make this clean, I'll add a helper SQL function `is_shipment_owner(shipment_id, user_id)` that returns true if:
  - user is admin/super_admin, OR
  - `shipments.created_by = user_id`, OR
  - `shipments.import_manager_id` matches a row in `import_managers` whose email equals the user's auth email (existing convention).
- **Goods (shipment_items)** ownership = ownership of the parent shipment.
- **Suppliers** ownership = `suppliers.import_manager_id` mapped the same way (admins see all).
- **Distributions / distribution_items** ownership = ownership of the parent shipment.
- **Branch requests** ownership = ownership of the referenced shipment; requests with no shipment stay visible to all managers (cannot scope).
- **Vehicles** = shared. Visible to all staff. Closable only by:
  - admins, OR
  - `vehicles.created_by = user_id`, OR
  - user owns at least one shipment currently attached to the vehicle.

## Database changes (migration)

1. Add `public.is_manager_for_shipment(_shipment_id uuid, _user_id uuid) returns boolean` (security definer).
2. Add `public.is_manager_for_supplier(_supplier_id uuid, _user_id uuid) returns boolean`.
3. Add `public.can_close_vehicle(_vehicle_id uuid, _user_id uuid) returns boolean`.
4. Replace `shipments staff select` with: admin OR owner-of-shipment. Keep insert as `is_staff`. Update/delete already check `created_by` / admin.
5. Replace `shipment_items staff select/update/delete` with checks against `is_manager_for_shipment(shipment_id, auth.uid())`. Insert: must own the parent shipment (or be admin).
6. Replace `distributions staff all` and `distribution_items staff all` with manager-scoped policies (still allow branch read for own branch).
7. Replace `branch_requests staff all` and `branch_request_items staff all` with: admin OR (shipment_id IS NULL) OR owner of `shipment_id`. Keep branch policies.
8. Replace `suppliers read/write staff` with admin OR `is_manager_for_supplier`.
9. `vehicles staff update` → admin OR `can_close_vehicle`. Keep `vehicles staff read` open to all staff so other managers can attach their goods.

## UI / query changes

- **Shipments list** (`shipments/index.tsx`): for `import_manager` role, filter by ownership. Admins unchanged.
- **Distribution list** (`distribution.tsx`) and detail (`distribution/$shipmentId.tsx`): scope to current manager's shipments only.
- **Suppliers** (`suppliers.tsx`, admin/suppliers): managers see only their own suppliers.
- **Branch requests** (`branch-requests.tsx`): managers see only requests for their shipments + unassigned ones.
- **Vehicles / loading plan** UI: show all vehicles to managers (so they can join), but disable "close" button when `can_close_vehicle` would deny.
- Rely on RLS as the hard boundary; UI filters are belt-and-suspenders (and also drive correct empty states).

## Out of scope

- No changes to branch role visibility.
- No data migration of existing `import_manager_id` fields — assume they're already correct or admin will fix.

## Risk / verification

- After migration runs, log in as `qa.manager@tropik.test` and `qa.manager2@tropik.test` and verify each sees only own shipments/goods/distributions and cannot mutate the other's records (RLS denies).
- Verify admin still sees everything.
- Verify branch role unchanged.

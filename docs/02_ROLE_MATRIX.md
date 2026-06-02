# 02 — Role Matrix (Starter)

High-level only. This file documents intent, not the full RLS truth — for that, see the migrations and policies in Supabase.

| Role | Purpose | High-level visibility |
|---|---|---|
| **super_admin** | Owner / operator god-mode | Everything: schema, users, roles, all operational and reference data, activity, logs. |
| **admin** | Day-to-day admin without DB powers | All operational data and master data UIs; no direct schema access. |
| **import_manager** | Owns product positions, offers, shipments | Own positions and assigned shipments; supplier and cost data for their scope. |
| **branch** | Branch user | Own branch's assigned/distributed items only; no supplier, purchase, FX, customs, transport, or internal-cost fields. |
| **logistics** | Loading, vehicles, routes | Logistics and shipment routing data; limited or no purchase-cost visibility. |
| **broker** | Customs broker | Customs-relevant data only; no internal cost or supplier purchase prices. |

## Rules
- Roles are stored in `public.user_roles` (separate table) and checked via `public.has_role(uid, role)`.
- **Never** store role on profiles/users table.
- **Never** check role on the client only — always backed by RLS or `SECURITY DEFINER` functions.
- This matrix is a starter; detailed per-table permissions live in RLS policies and branch-safe views. Do not invent permissions here that are not implemented.

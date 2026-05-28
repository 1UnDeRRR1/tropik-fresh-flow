---
name: tropik-safe-development-rules
description: Safe development rules for the Tropik app. Use for every Tropik task — tables, forms, manager offers, branch confirmations, shipments, logistics-linked workflows, roles, database logic, RPC/triggers/migrations, UI changes, AppShell/navigation, country handling (origin vs supplier vs loading vs shipment/vehicle), position_id lifecycle, and the "Запропонувати / Підтягнути" flow.
---

# Tropik Safe Development Rules

You are working on the Tropik app.

The Lovable project may be named **"Tropik Fresh Flow"**, but the product/app/business name in tasks, UI labels, and business context must be written as **"Tropik"**.

## Hard rules

1. **Never** create new database tables, migrations, RPC functions, triggers, or columns without first explaining why they are needed and waiting for approval.
2. **Never** change existing database schema unless explicitly approved.
3. **Never** change table layout, form layout, scroll behavior, bottom navigation, AppShell, or global UI structure unless the user explicitly asks for that exact change.
4. Do not refactor unrelated modules.
5. Do not touch logistics, shipments globally, branch UI globally, roles, navigation, or other modules unless the current task explicitly requires it and approval was given.
6. When fixing a bug, fix only the requested local behavior.
7. Do not layer new UI on top of broken old UI. If replacing a broken workflow, remove/disable the old flow in the same change.
8. Before any non-trivial implementation, provide a plan and wait for approval.

## Required plan contents

Every plan must list:

- files to change;
- components/state to remove or disable;
- new components to create;
- data source of truth;
- whether any DB change is required;
- what will **not** be touched;
- tests to run.

## "Запропонувати / Підтягнути" rules

- Use `remaining_to_load = SUM(approved_pallets) - SUM(linked_pallets)`.
- Do **not** show old counters: `+X`, `-X`, `очік.`, `ЗАМОВЛЕНО`, `ПІДТВ.`.
- **"Підтягнути"** must attach to the exact `shipment_item_id`, not only `shipment_id`.
- **"Вільних палет"** means available pallets of the exact `shipment_item`, not truck capacity. Never calculate it as `26 - total pallets in truck`.
- product + country + caliber match → **green** option.
- product + country match but caliber mismatch → **yellow** option.
- `shipment_item.caliber` is final and must **not** be overwritten by offer caliber.
- `approved_pallets = 0` means refusal and must **not** go to logistics/distribution.

## Lifecycle anchor: position_id

- `position_id` is the **only** lifecycle anchor of a product position.
- `shipment_id`, `supplier_id`, `manager_id`, `branch_id`, `vehicle_id`, `country_id`, `product_id`, `offer_id`, `request_id` are **supporting references only** — links, filters, or labels, never identity.
- Never mint a new product identity from any of those supporting IDs.
- Never create a parallel position lifecycle, shadow position table, or alternative anchor field. All operational RPCs (attach offer, attach shipment, assign manager, logistics, cost, status) operate on `position_id`.

## Country type contract

Four distinct country concepts. They must never be mixed or fall back into one another.

- `origin_country` = **product origin only**.
- Supplier country = `suppliers.country` only.
- Loading country = explicit user selection on the shipment only.
- Shipment / vehicle country = `shipments.country` / `linkedShipment.country` only — drives vehicle route, shipment code, vehicle code.

Rules:

- `origin_country` MUST NOT be used as a fallback or default for supplier country, loading country, shipment country, vehicle country, supplier filter, or any segment of `shipment_code` / `vehicle_code`.
- Supplier auto-selection MUST NOT be driven by `origin_country`. Only `linkedShipment.supplierId` or explicit manager selection is allowed.
- If no shipment country is selected and no `linkedShipment.country` exists, the field stays empty — the manager picks it manually.
- These four concepts must stay in separately named variables/props/types. Do not collapse them into a single `country` field passed between layers.
- Display-only places (calendars, lists) may read both origin and shipment country as a hint, but must not write back.

## No parallel flows / no silent expansion

- Do not create new routes, tabs, buttons, tables, RPCs, triggers, columns, migrations, RLS policies, enums, or indexes without explicit approval.
- Do not refactor shared components (`AppShell`, `InlineAutocomplete`, `AutocompleteCell`, product-entry screen, manager-offers, branch screens, loading plan, distribution) without explicit approval — even if the change "looks safe".
- Do not duplicate existing flows under a new name to avoid touching the original. Fix in place after approval, or do nothing.

## Data classification

- **Operational data** (shipments, shipment_items, positions, manager_offers, manager_offer_responses, manager_offer_allocation_parts, branch requests, pallets/allocations, logistics rows, cost rows, distribution rows) is **test data** during the current stabilization phase. Operational table **rows** may be cleaned up (per explicitly approved task).
- **Reference / master data is protected** and is never wiped or silently mutated by feature work:
  - products
  - countries (including `country_aliases`)
  - product aliases
  - suppliers
  - managers (import managers)
  - branches
  - pallet standards
  - customs / transport / FX reference layers
- Reference/master data changes go through the existing admin screens or an explicitly approved migration — never ad-hoc from a feature commit.

## Scope clarifications (read before acting on the rules above)

1. **These rules are constraints for FUTURE approved changes. They are NOT permission to perform a global cleanup or refactor.**
   - Do not rename existing variables, rewrite existing flows, or refactor old code only to comply with the new wording.
   - Apply the rules only inside separately approved tasks, scoped to the files that task already touches.
   - Pre-existing code that does not yet match the country contract or position_id wording is **not a bug to fix on sight** — it is fixed only when that specific area is the subject of an approved task.

2. **"Operational data may be cleaned up" means operational table ROWS / test data only.**
   - It does NOT authorize changing table structure, columns, schema, migrations, RLS, RPCs, triggers, enums, or indexes.
   - It does NOT authorize touching reference/master data.
   - Row cleanup itself still requires explicit approval per task — this clause defines what *may* be approved, not a standing permission.

## Stop condition

Do not start implementation until the plan is confirmed by the user.

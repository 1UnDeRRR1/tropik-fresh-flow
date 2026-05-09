# Responsive Adaptation Plan — All Roles

Goal: one unified app that feels native on phone, tablet, and desktop for every role (super_admin, admin, import_manager, branch). No "stretched mobile" on desktop — desktops get wider tables, more visible columns, multi-column layouts.

## Strategy

1. **Global shell (`AppShell`)**
   - Mobile (`<md`): keep current bottom navigation + top bar.
   - Tablet/Desktop (`≥md`): add a left rail / sidebar with the same role-aware items, hide bottom nav, expand main content to a centered max-w-7xl container with proper paddings (`px-4 md:px-6 lg:px-10`).
   - Role-aware nav items stay identical; only layout/placement changes.

2. **Reusable responsive primitives**
   - Add `ResponsiveTable` helper: renders stacked cards on mobile, real `<table>` on `md+` from the same row data.
   - Add `PageContainer` wrapper enforcing consistent max-width + breakpoint paddings.
   - Add `FilterBar` that becomes a horizontal toolbar on desktop and stacked dropdowns on mobile.

3. **Per-page adaptation** (Ukrainian UI preserved everywhere):

   - **Admin dashboard** (`dashboard/admin.tsx`, `dashboard/super-admin.tsx`): KPI tiles 1col → 2col (md) → 4col (lg); shortcut grid 2col → 4col → 6col.
   - **Analytics** (`analytics.tsx`): tabs stay; on desktop show 2-column layout (list + detail panel side-by-side instead of dialog); product/owner rows render as table on `md+`.
   - **Statistics** (`statistics.tsx`): filter bar inline on desktop (5 dropdowns in one row), stacked on mobile; results render as wide table on desktop.
   - **Triggers** (`admin/triggers.tsx`): card list on mobile, table on desktop with all columns visible.
   - **Calendar** (`calendar.tsx`): mobile = vertical day list (current); desktop = day list + selected-day detail panel side-by-side, with wider date headers.
   - **Import manager dashboard** (`dashboard/manager.tsx`): KPI grid responsive; shipment list → table on desktop.
   - **Shipment creation** (`shipments/new.tsx`): single-column form on mobile, 2-column form (label/inputs paired) on desktop with wider inputs.
   - **Product entry** (`shipments/$id.products.tsx`): card-per-product on mobile, spreadsheet-style editable table on desktop.
   - **Distribution matrix** (`distribution.tsx`, `distribution/$shipmentId.tsx`): vertical list on mobile, true matrix grid (products × branches) on `lg+` with sticky headers.
   - **Branch page** (`dashboard/branch.tsx`): cards stack on mobile, 2-column dashboard on desktop.
   - **Branch calendar**: same pattern as admin calendar.
   - **Branch transfer offers** (`offers.tsx`, `transfers.tsx`): cards on mobile, table on desktop.
   - **Requests** (`branch-requests.tsx`): cards on mobile, table on desktop with status/date columns.

4. **Breakpoints**
   - `sm` 640, `md` 768 (tablet), `lg` 1024 (desktop), `xl` 1280 (wide desktop).
   - Use Tailwind responsive classes only; no JS device detection except where needed for table↔card swap (use CSS via `hidden md:block` / `md:hidden`).

## Out of scope
- No business logic changes.
- No new features, no role permission changes.
- No visual redesign — same tokens, same components.

## Technical notes
- All edits in `src/components/AppShell.tsx` and the listed route files.
- New helpers: `src/components/ResponsiveTable.tsx`, `src/components/PageContainer.tsx`, `src/components/FilterBar.tsx`.
- Verify with viewport at 390px, 820px, 1440px.

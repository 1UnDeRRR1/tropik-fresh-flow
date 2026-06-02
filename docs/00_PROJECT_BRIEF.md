# 00 — Project Brief

## Name
**Tropik Fresh Flow**

## What it is
A mobile-first PWA / web platform for managing fresh-produce import operations end-to-end.

## Primary use cases
- **Supplier offers**: capture, compare, and accept supplier offers per product position.
- **Branch requests**: branches submit demand for product positions; managers review and allocate.
- **Shipment creation**: assemble shipments from accepted offers and branch demand.
- **Logistics**: track loading plan, vehicles, drivers, routes, ETA.
- **Customs & cost control**: customs status, duties, FX, transport cost, internal cost roll-up.
- **Product distribution**: allocate shipment items to branches, manage free pallets, transfers.
- **Role-based visibility**: separate views and permissions for super_admin, admin, import_manager, branch, logistics, broker.

## Form factor
- Mobile-first PWA, also usable on desktop.
- Used in the field (branches, warehouses, on the road) and in the office.

## Backend
- Lovable Cloud (Supabase) for DB, auth, storage, realtime.
- TanStack Start server functions for app-internal server logic.
- `/api/public/*` server routes only for webhooks and cron.

## Non-goals
- Not an e-commerce storefront.
- Not a public catalog.
- Not a generic ERP — scope is fresh-produce import lifecycle.

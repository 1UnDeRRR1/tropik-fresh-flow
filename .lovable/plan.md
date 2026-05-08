## Goal

Add a customs reference database and a cost-price calculation module that combines supplier price (USD), transport cost per kg (USD), and customs cost into two final cost prices per shipment item: **індикативна** and **інвойсна собівартість**. All math is USD-based, mobile-first, Ukrainian UI.

## Database (one migration)

1. **New table `customs_reference`**
   - `id uuid pk`
   - `product_name text not null`
   - `country text not null`
   - `threshold_price_usd numeric not null default 0`
   - `customs_fee_percent numeric not null default 0`
   - `euro1_markup_usd numeric not null default 0`
   - `active boolean not null default true`
   - `created_at`, `updated_at` + touch trigger
   - Unique partial index on `(lower(product_name), lower(country))` where `active = true`
   - RLS: read for authenticated; write for admin/super_admin (`is_admin`)

2. **Computed columns on `shipment_items`** (kept in DB so matrix/branch/admin queries are cheap)
   - `customs_cost_indicative numeric` (per kg, USD)
   - `customs_cost_invoice numeric` (per kg, USD)
   - `final_cost_indicative numeric` (per kg, USD)
   - `final_cost_invoice numeric` (per kg, USD)
   - `customs_match_id uuid` (nullable; resolved customs_reference row)

3. **Trigger `calc_shipment_item_costs`** on `shipment_items` insert/update of `unit_price_usd`, `product_name`, plus a recompute on shipment country change:
   - Find best `customs_reference` row by `lower(product_name)=lower(NEW.product_name)` + shipment.country, `active=true`.
   - If `unit_price_usd <= threshold_price_usd` → `customs_cost_indicative = euro1_markup_usd`, `customs_cost_invoice = euro1_markup_usd` (indicative path applies).
   - Else compute invoice path:
     - `vat_part = unit_price_usd * 0.20`
     - `result2 = unit_price_usd + vat_part`
     - `customs_fee = result2 * customs_fee_percent / 100`
     - `customs_cost_invoice = vat_part + customs_fee + 0.015`
     - `customs_cost_indicative = euro1_markup_usd` (still kept as reference)
   - Final costs use **transport_cost_per_kg** computed live in app (transport allocation already exists in `src/lib/transport.ts`); for DB-stored `final_cost_*` we approximate using snapshot transport from `shipments.logistics_cost_usd` and total weight at trigger time. Final authoritative numbers come from the front-end formula in `src/lib/cost.ts`.

4. **Recompute trigger** on `shipments` update of `country` or `logistics_cost_usd` → recompute all child shipment_items costs.

## Frontend

1. **New `src/lib/cost.ts`**
   - `computeCustoms({ unitPriceUsd, ref }) → { indicative, invoice, base }`
   - `computeFinalCost({ unitPriceUsd, transportPerKgUsd, customsUsd }) → number`
   - Formatters reuse `fmtUSD` from `src/lib/currency.ts`.

2. **Admin page `src/routes/_authenticated/admin/customs.tsx`** (new)
   - CRUD list + form for `customs_reference`. Columns: товар, країна, поріг $, мито %, Euro1 $, активність.
   - Mobile-first card list + edit dialog.
   - Linked from `admin/index.tsx` tile "Митний довідник".

3. **Shipment item details (`shipments/$id.tsx` → `ShipmentItemRow` + Products tab)**
   - Show: Митна база (база = `unit_price_usd`), Націнка Euro1, Митний збір %, Митна вартість (індикативна / інвойсна), Транспорт $/кг, Індикативна собівартість, Інвойсна собівартість.
   - Badge if no customs_reference match found ("Немає в митному довіднику").

4. **Logistics tab** — add summary row per item: "Індикативна / Інвойсна" using live transport allocation × customs.

5. **Distribution matrix (`distribution/$shipmentId.tsx`)**
   - Add per-item subtitle line: `Інд. собівартість $X.XX/кг • Інв. собівартість $Y.YY/кг`.

6. **Branch view (`dashboard/branch.tsx`)**
   - Show per-item `Собівартість (інд / інв) $/кг`. No EUR shown.

7. **Admin / analytics (`analytics.tsx`)**
   - Add aggregate column: середня індикативна / інвойсна $/кг за поставку.

8. **`costs.tsx` page** — replace placeholder with real explanation + last 20 calculated items table.

All labels Ukrainian: «Індикативна собівартість», «Інвойсна собівартість», «Митна база», «Націнка Euro1», «Митний збір %», «Поріг ціни», «Митний довідник».

## Out of scope

- Editing customs_reference from non-admin roles.
- Recomputing historical shipments retroactively when reference changes (only re-saves trigger recompute).
- Currencies other than USD for final cost.

## Files

- migration `supabase/migrations/<ts>_customs_costs.sql` (table + columns + triggers + RLS)
- create `src/lib/cost.ts`
- create `src/routes/_authenticated/admin/customs.tsx`
- edit `src/routes/_authenticated/admin/index.tsx` (add tile)
- edit `src/routes/_authenticated/shipments/$id.tsx` (item row + logistics tab)
- edit `src/routes/_authenticated/distribution/$shipmentId.tsx`
- edit `src/routes/_authenticated/dashboard/branch.tsx`
- edit `src/routes/_authenticated/analytics.tsx`
- edit `src/routes/_authenticated/costs.tsx`

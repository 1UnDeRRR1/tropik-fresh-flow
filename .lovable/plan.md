## Goal

Make USD the system's base accounting currency. Suppliers' product prices and shipment transport/freight cost can be entered in EUR or USD. EUR values are auto-converted via Frankfurter API and a per-shipment exchange rate snapshot. All calculations, analytics and branch views switch to USD.

## Database changes (one migration)

1. **New table `exchange_rates`**
   - `id`, `base_currency` (default 'EUR'), `target_currency` (default 'USD'), `rate numeric`, `source text` (default 'frankfurter'), `rate_date date`, `created_at`
   - Unique on `(base_currency, target_currency, rate_date)`
   - RLS: read for authenticated; insert for staff (filled by edge function with service role)

2. **`shipment_items`**
   - Add `price_currency text not null default 'EUR'` (currency for `unit_price`)
   - Add `unit_price_usd numeric` (snapshot converted price in USD)
   - Add `fx_rate_used numeric` (rate snapshot used for this row, EUR→USD; 1 when USD)

3. **`shipments`**
   - Add `logistics_cost_currency text not null default 'EUR'`
   - Add `logistics_cost_usd numeric`
   - Add `eur_usd_rate numeric` (shipment's exchange-rate snapshot, set when first EUR value is saved)
   - Add `eur_usd_rate_date date`
   - Repurpose existing `currency`/`fx_rate` already on shipments to keep transport snapshot consistent (we'll write the new explicit columns and leave legacy columns untouched).

4. **Trigger** on `shipment_items` insert/update: if `price_currency='USD'` then `unit_price_usd = unit_price`, `fx_rate_used = 1`; if `EUR` and shipment has `eur_usd_rate`, compute `unit_price_usd = unit_price * eur_usd_rate`.

## Exchange rate fetcher

- New server route `src/routes/api/public/hooks/refresh-fx.ts` (POST):
  - Calls `https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD`
  - Upserts row into `exchange_rates` for today (`source='frankfurter'`)
- Schedule via `pg_cron` daily at 06:00 UTC (insert tool, not migration).
- Helper `getLatestEurUsdRate()` server fn reads the most recent row from `exchange_rates`.

## Shipment-level snapshot logic

- When a shipment is created or first time an EUR value is saved, fetch latest rate from `exchange_rates` and store `eur_usd_rate` + `eur_usd_rate_date` on the shipment. Never overwrite afterwards (historical immutability).
- When transport cost is saved with currency=EUR: `logistics_cost_usd = logistics_cost * eur_usd_rate`. With USD: copy as-is, rate stays 1 for that field.

## Frontend changes

1. **New util `src/lib/currency.ts`**
   - `CURRENCIES = ['EUR','USD']`, `fmtUSD`, `fmtEUR`, `convertToUsd(amount, currency, rate)`, `usdPerKg(...)`.

2. **Shipment item form (Products tab in `shipments/$id.tsx`)**
   - Add small currency `<Select>` (EUR default) next to `unit_price`
   - Show original entered value + currency, then under it: rate used and converted USD value (e.g. "≈ 12.45 USD @ 1.085")

3. **Logistics tab (transport cost block)**
   - Currency selector next to total transport cost (EUR default)
   - Show `eur_usd_rate` snapshot, converted USD total, and per-row `$/кг`
   - Update `allocateTransport` consumer to compute USD-based allocation and `$/кг`

4. **`src/lib/transport.ts`**
   - Keep weight allocation logic; add `fmtUsd` helper. Pass USD total cost into `allocateTransport` from caller. No EUR in displayed analytics.

5. **Analytics (`analytics.tsx`)**
   - Replace €/kg with $/kg using `logistics_cost_usd` and total weight.

6. **Branch views, dashboards** that show price/cost — switch to `unit_price_usd` and `$/кг`.

7. **Admin / shipments/new** — default currency selectors to EUR; persist chosen currency on save.

All UI labels in Ukrainian (e.g. "Валюта", "Курс EUR/USD", "Сума у USD", "$/кг"). Mobile-first cards consistent with existing patterns.

## Out of scope

- Customs cost calculation (separate later module).
- Final product cost computation.
- Rates other than EUR/USD.

## Files to create / edit

- create `supabase/migrations/<ts>_currency_usd.sql`
- create `src/lib/currency.ts`
- create `src/routes/api/public/hooks/refresh-fx.ts`
- edit `src/lib/transport.ts`, `src/routes/_authenticated/shipments/$id.tsx`, `src/routes/_authenticated/shipments/new.tsx`, `src/routes/_authenticated/analytics.tsx`, `src/routes/_authenticated/dashboard/branch.tsx`, `src/routes/_authenticated/distribution/$shipmentId.tsx` (where prices/cost shown)
- insert tool: schedule pg_cron job + seed today's rate

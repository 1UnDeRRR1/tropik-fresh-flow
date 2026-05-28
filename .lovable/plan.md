
# Fix: origin_country leak in shipment creation from offer

## Scope (single file, local fix)

Only file changed:
- `src/routes/_authenticated/shipments/new.tsx`

No helper file is needed. The bug is fully contained in two adjacent blocks of this route (the `fromOfferPrefill` query and the supplier auto-pick effect). Extracting a helper would expand scope and touch shared code, which is explicitly out of scope.

## Root cause

In `src/routes/_authenticated/shipments/new.tsx`:

1. Line ~364 — prefill returns:
   ```ts
   country: linkedShipment?.country ?? offer.origin_country ?? null
   ```
   This makes product `origin_country` fall through as the shipment/loading country whenever there is no linked shipment.

2. Lines ~380–410 — when there is no linked-shipment supplier, the effect uses `fromOfferPrefill.country` (which, per #1, may actually be `origin_country`) as `targetCountry` and filters `suppliers` by `supplier.country === targetCountry`, auto-selecting the first match.

3. Lines ~373–378 — the country-prefill effect then writes that same `fromOfferPrefill.country` into the shipment `country` state, which downstream feeds the shipment code's country segment and the vehicle code (`previewCc = getCountryCode(country)`).

Net effect with Mango / Peru: `origin_country = "Peru"` propagates into shipment country, vehicle/shipment code country segment, and supplier filter — violating the country-separation rule.

## Exact logic to remove

In `src/routes/_authenticated/shipments/new.tsx`:

1. In the `fromOfferPrefill` queryFn return object, remove the `?? offer.origin_country` fallback:
   ```ts
   // remove:
   country: linkedShipment?.country ?? offer.origin_country ?? null,
   ```

2. Drop `origin_country` from the offer `.select(...)` on line ~345 (no other consumer of `fromOfferPrefill` reads it).

3. In the supplier auto-pick effect (lines ~380–410), remove the entire country-based fallback branch:
   - `const targetCountry = normalizeCountry(fromOfferPrefill.country ?? "");`
   - the `scopedManagerId` / `scopedPool` / `pools` block
   - the `for (const pool of pools) { ... countryMatches ... setSupplierId(countryMatches[0].id) ... }` loop

## Exact new logic to add

1. New prefill shape (no origin fallback):
   ```ts
   return {
     supplierId: linkedShipment?.supplier_id ?? null,
     country: linkedShipment?.country ?? null,           // only from linked shipment
     offerManagerId: offer.import_manager_id ?? null,
     offerPositionId: (offer as { position_id?: string | null }).position_id ?? null,
   };
   ```

2. Supplier auto-pick effect, reduced to direct linked-shipment supplier only:
   ```ts
   useEffect(() => {
     if (supplierId || !fromOfferPrefill || !suppliers?.length) return;
     if (!fromOfferPrefill.supplierId) return;           // no linked shipment → no auto-pick
     const directSupplier = suppliers.find(s => s.id === fromOfferPrefill.supplierId);
     if (directSupplier) setSupplierId(directSupplier.id);
   }, [fromOfferPrefill, suppliers, supplierId]);
   ```
   (Drop `currentManagerId` from the deps list since it is no longer used here.)

3. Country prefill effect (lines ~373–378) stays as-is in structure — but because `fromOfferPrefill.country` is now `null` unless a linked shipment exists, it naturally no longer prefills from `origin_country`. No code change required there beyond verifying behavior.

4. Re: business rule #3 ("direct `supplier_id` on offer"): confirmed via `\d manager_offers` that `manager_offers` has no `supplier_id` column today. The only direct supplier source is `linked_shipment.supplier_id`, which is preserved. No new column, no new query — explicitly out of scope.

## Result vs. regression scenario

Mango / `origin_country = Peru`, no linked shipment:
- `fromOfferPrefill.country` → `null` → shipment `country` stays empty → manager picks it manually.
- Supplier auto-pick early-returns (no `supplierId` from linked shipment) → supplier list is not filtered by Peru, nothing auto-selected.
- `previewCc` / shipment code country segment is driven solely by the manually selected `country`.
- Peru remains only as product origin on the offer record.

With a linked shipment:
- Country comes only from `linkedShipment.country`.
- Supplier comes only from `linkedShipment.supplier_id`.

## Out of scope — explicit confirmation

No changes to:
- DB / schema / migrations / RLS / triggers / RPCs / enums / indexes
- routes, route tree, navigation, tabs, buttons
- UI layout of `shipments/new.tsx` (only the two effect/query bodies above)
- product-entry screen, manager-offers screens, branch screens, loading plan, distribution
- shared components (AppShell, InlineAutocomplete, AutocompleteCell, etc.)
- `manager_offer_allocation_parts` and related RPCs
- any other file in `src/`

## Manual smoke test

1. Open an offer with `origin_country = Peru` and no `linked_shipment_id`. Click "Create shipment from offer".
   - Expect: shipment country field is empty; vehicle/shipment code preview has no country segment; supplier field is empty; supplier dropdown shows the full allowed list (not filtered to Peru).
2. Manually select loading country = Turkey, then pick a Turkish supplier.
   - Expect: shipment code country segment reflects Turkey, not Peru.
3. Open an offer whose `linked_shipment_id` points to a shipment with `country = Turkey`, `supplier_id = X`.
   - Expect: country prefills to Turkey; supplier prefills to X; no Peru anywhere.
4. Open an offer with `linked_shipment_id` set but the shipment has `country = null` and `supplier_id = null`.
   - Expect: country empty, supplier empty, no fallback to `origin_country`.
5. Sanity: existing "create shipment" flow (not from offer) is unchanged — country and supplier behave as before.

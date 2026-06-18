## Build B — integration plan for `/shipments/new`

Goal: make the existing card editor on `/shipments/new` fully active and back its math with `shipment-row-engine`. No new form, no early shipment INSERT, no formula duplication, no `$id.products.tsx` changes.

### Files to touch (allowed scope only)

1. `src/routes/_authenticated/shipments/new.tsx` — wire to engine, remove local duplication.
2. `src/lib/shipment-row-engine.ts` — backward-compatible additions only (see §3).
3. NEW `src/lib/shipment-row-service.ts` — pure data-loading helpers (customs refs, FX, vehicle context, pallet standard lookup) reused by both editors; no React, no JSX.
4. `src/lib/commit-shipment-row.ts` — widen INSERT payload typing only (passthrough), no behavior change.
5. `src/styles.css` — only `.shipments-new-products` scoped tweaks if a row card needs them.

Explicitly NOT touching this Build: `$id.products.tsx`, AppShell, AutocompleteCell, InlineAutocomplete, manager-offers, branch screens, loading plan, distribution, any DB schema/RLS/RPC/trigger, reference data.

### 1. Local `DraftRow` ↔ engine `DraftRow` reconciliation

Current `new.tsx` `DraftRow` (line ~505) has extras that engine doesn't: `brand`, `class`, `source_offer_freight_amount`, `source_offer_freight_currency`, **no** `resolver_*`/`auto` flags (uses different totals model).

Decision: **extend engine `DraftRow` with optional `brand?: string` and `class?: string`** (backward-compatible — `$id.products.tsx` ignores undefined). Keep `source_offer_freight_*` already present on engine. Do NOT collapse the two flows yet. `new.tsx` will use engine `DraftRow` directly, and add `brand`/`class` fields wired to UI inputs that were previously dead.

Why: avoids two parallel contracts; preserves $id.products invariants because new optional fields never reach update path there.

### 2. Engine helpers `new.tsx` will call (all already exist except as noted)

- `isNetGreaterThanGross(d)` — replaces inline `r.net_weight_kg > r.gross_weight_kg` check at L662.
- `sumCapacity(rows)` — replaces the local `gross` reducer at L1330 and the 21500/26 derivations.
- `getMissingDraftFields(d, products)` — replaces the per-row validation block L654–L680.
- `computeRowPreview(d, dbItem=null, sh, vehicleContext, refs, latestEurUsd, products, isClean=false, savedRefForClean=null)` — drives indicative/invoice and the customs chip basis (`exact|fallback|none|manual`).
- `pickCustomsRefForDraft`, `computeCustomsPreview` — used indirectly through `computeRowPreview`.
- `buildPayload(d, ctx, { forUpdate: false })` — replaces the ad-hoc payload at L863–L890, but `new.tsx` still appends `brand`, `class`, and the manual-customs fields (see §3) after the engine payload, because the engine excludes trigger-owned columns and brand/class are not in the engine contract today.

**Backward-compatible engine additions** (only what's strictly needed):

- Add optional `brand?: string` and `class?: string` to `DraftRow` and `DRAFT_EDITABLE_KEYS`.
- Add optional `appendBrandClass?: boolean` to `buildPayload` opts, OR (preferred) keep `buildPayload` untouched and let `new.tsx` spread `{ brand, class }` after the engine payload. Preferred = no engine change for this.

### 3. Manual customs override (red → confirm)

Local-only until final `Створити`. State held in `new.tsx` per `localId`:
```
manualOverride: Record<localId, { duty_usd: number; confirmed_at: string; by: string }>
```
On INSERT, when present for a row, `new.tsx` adds `customs_override_duty_usd`, `customs_override_confirmed_at`, `customs_override_by` to the payload sent through `commitNewShipmentItem`. The engine's `computeRowPreview` already honors `dbItem.customs_override_*` for clean rows; here `dbItem` is `null`, so `new.tsx` passes a synthetic `dbItem`-like object for the preview when manual override is active, OR (cleaner) we extend `computeRowPreview` with optional `localOverride: { duty_usd, confirmed_at, by } | null` — purely additive parameter, default `null`, $id.products.tsx call sites untouched.

Decision: **additive `localOverride` parameter on `computeRowPreview`**. Smaller blast radius than synthesizing a fake `ItemRowLike`.

Red status blocks `Створити` for that row until override confirmed in UI. Yellow and green do not block.

`commit-shipment-row.ts` payload typing widened (passthrough) to permit the three override columns + `brand` + `class` to flow through unchanged. No logic added.

### 4. `shipment-row-service.ts` (new, pure)

Exports React Query option factories used by both editors. For Build B only the new ones `new.tsx` needs:
- `activeCustomsRefsQuery()` → `ActiveCustomsRef[]`
- `latestEurUsdQuery()` → `number | null`
- `vehicleContextQuery(vehicleId)` → `VehicleContextLike | null`
- `palletStandardBoxesPerPalletQuery(productName, packageUsed)` → `number | null` (read-only `boxes_per_pallet`)

`new.tsx` consumes these via existing `useQuery` plumbing. No new RPCs, no new tables, no schema. `$id.products.tsx` is not modified — it can adopt the service later in a separate task.

### 5. Brand / class

- Inputs in card become live and feed `draftRow.brand` / `draftRow.class`.
- INSERT payload spreads them after the engine payload.
- Shared engine `DraftRow` gains optional `brand?` / `class?` only. `itemRowToDraft` does not populate them (so $id.products.tsx round-trip is unchanged and cannot null-out existing DB values from old editor).

### 6. Ящ./пал.

- Read-only chip in card, fed by `shipment-row-service.palletStandardBoxesPerPalletQuery(product, package_used)`. Returns `boxes_per_pallet` directly from `pallet_standards`.
- No edit, no fake value, no new column.

### 7. Preview context

- `mode === "new"`: `sh = { eur_usd_rate: localFx ?? latestEurUsd, vehicle_id: null, logistics_cost_usd: localTransportUsd }`, `vehicleContext = null`.
- `mode === "existing"`: real `sh` and `vehicleContext` from existing vehicle/shipment queries that `new.tsx` already runs (L189). No new query for shipments-share-vehicle since it's already in scope.

### 8. Preserved invariants

- Header "Далі" stays UI-only (0 DB writes).
- Back button → 0 DB writes (no temp shipment).
- Single final `Створити` boundary calls existing `commitNewShipmentItem` per row.
- `position_id` flow unchanged (already passed via `source_position_id` → `commitNewShipmentItem`).
- FIFO offer link unchanged (commit helper handles it).
- Capacity 26 / 21500 enforced via `sumCapacity` + same toast text.
- Recognition gate (product/country must resolve before first INSERT) unchanged.

### 9. Removed as dead duplication

- Local `gross` reducer at L1330 → `sumCapacity`.
- Inline net>gross check at L662 → `isNetGreaterThanGross`.
- Per-row required-fields block L654–L680 → `getMissingDraftFields`.
- Any hardcoded "—" in numeric preview cells (replaced by real engine values or genuine "потрібно заповнити" placeholder).
- Local `DraftRow` definition L505 → engine `DraftRow`.

Not removed in this Build:
- `/draft-mockup` route, `new-draft-test` route — per instruction, deferred to cleanup task after acceptance.
- Existing supplier/vehicle/code/loadingDate/eta UI in the header — unchanged.

### Test checklist (executed after edits)

1. `bunx tsc --noEmit` clean.
2. `bun run build` clean.
3. UI: Product/Country/Variety/Brand/Class/Caliber/Packaging/Pallets/Net/Gross/Price/Currency all editable.
4. Back from /shipments/new → 0 rows in `shipments` & `shipment_items` for this attempt (verified by `SELECT count(*) WHERE created_at > <start>` diff).
5. Net=1000 / Gross=900 → `Створити` blocked with toast.
6. 27 pallets → blocked; 21500+ kg → blocked (same toast strings as $id.products).
7. Customs green (Avocado + Peru), yellow (Avocado + a recognized country absent from avocado customs list, e.g. Azerbaijan via dropdown selection), red (fake product or a recognized product+country pair with no customs row).
8. Red → row blocks creation until manual override confirmed; after confirm, preview shows manual indicative=invoice=override.
9. Indicative/invoice pair rendered in row & header.
10. After `Створити` succeeds: DB row has `customs_match_id` and `final_cost_*` populated by trigger (preview never wrote them).
11. Offer-derived row: `shipment_items.position_id` == offer's `position_id`; exactly one `manager_offer_allocation_parts` row created.

### Risks and mitigations

- **DraftRow contract drift**: mitigated by additive optional fields (`brand?`, `class?`) and additive optional `localOverride` param on `computeRowPreview`. $id.products.tsx call sites compile and behave identically.
- **Local manual override leakage**: stored only in `new.tsx` state, included in INSERT payload only on final commit. Never persisted as a draft anywhere.
- **commit-shipment-row payload widening**: passthrough typing only. Existing offer path unaffected.
- **Preview context mismatch for "new vehicle"**: synthesized `sh` matches the field shape engine reads (`eur_usd_rate`, `vehicle_id`, `logistics_cost_usd`); other engine fields read from `vehicleContext` are guarded behind `vehicle_id` check.
- **No early shipment row** confirmed via Back-flow test (#4).

### What I need from you to start

Confirm:
- (a) **engine `DraftRow` gets optional `brand?` / `class?`** (no other shape change), and **`computeRowPreview` gets optional `localOverride` param** — both purely additive;
- (b) `new.tsx` uses engine `DraftRow` directly (not a local type), keeping all current header/back/save boundaries;
- (c) `shipment-row-service.ts` scope limited to the four query factories listed in §4 (no other helpers);
- (d) the red-block UX is "Створити" stays disabled for that row's contribution until `Підтвердити митну ставку вручну` is clicked in the inline manual-override field (same component as `$id.products.tsx`: `CustomsManualOverrideField`).

On `yes`, I implement and return the Build report. On `no` or partial, tell me which point to revise.
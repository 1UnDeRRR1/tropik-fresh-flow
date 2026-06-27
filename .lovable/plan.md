## Scope (visual-only, /shipments/new)

Unify all field styling on the new shipment creation screen to match the "Товар" field. No logic, no layout, no validation, no DB, no shared components outside this screen.

## 4 requested rules

1. **Background behavior** — all input/select/popover-trigger fields:
   - idle: transparent background
   - focused (or popover open): solid black background
   - blur: back to transparent
2. **Typography unified** — same font-family, size (13px), weight and color as "Товар" for: placeholder, typed value, selected value, filled value, dropdown options.
3. **Optional fields border** — light-grey border with identical thickness/radius/inset as the current red required border (so optional and required differ only in color).
4. **Required-field border state** — red while empty/invalid; turns light-grey once the field is filled and user leaves it. Optional fields never change color.

All other behavior (dropdown anchoring, animations, validation triggers, popover content, field order, labels, capacity bar, sticky header, keyboard handling) stays exactly as today.

## Files touched

- `src/styles.css` — extend the existing `.shipment-create-screen` scoped block:
  - normalize background/border tokens for `input`, `select`, `button[role="combobox"]`, popover triggers, `StrictDatePicker` trigger, `StrictAutocompleteCard`/`StrictSelectCard` triggers, and the numeric `€`-suffix wrappers
  - add `:focus`/`:focus-within`/`[data-state="open"]` → black background
  - add `[data-required="true"][data-filled="false"]` → red border; otherwise → light-grey border
  - unify font-size/family/color rules already partially present
- `src/routes/_authenticated/shipments/new.tsx` — only attribute additions on the header fields (Постачальник, Країна завантаження, Дата завантаження, ETA, Транспорт):
  - add `data-required="true"` and `data-filled={hasValue}` so CSS can flip the border color on blur without touching JS validation
- `src/components/shipments/NewShipmentProductCard.tsx` — same attribute additions on Походження, Калібр, Нетто, Брутто, Ціна за кг, and the wrapper cells for Ящ./пал., К-ть палет, Вага палети so optional vs required is expressed declaratively.

No edits to: `ShipmentProductCard.tsx` (saved editor), `cells.tsx` shared primitives outside this screen, `AutocompleteCell`, `InlineAutocomplete`, `Input`/`Textarea`/`Select` shadcn primitives, `AppShell`, `useKeyboardInset`, manager-offers, distribution, loading plan, `/shipments/$id/products`.

## DB / RPC / RLS / Auth

None. Pure CSS + JSX attribute additions on a single screen.

## Verification matrix (to be reported after Build)

- Товар field appearance unchanged: yes/no
- Idle background transparent on every field: yes/no
- Focused background black on every field (incl. date trigger, €-suffix wrapper, Сорт/Клас selects, Упаковка autocomplete): yes/no
- Blur returns to transparent: yes/no
- Optional fields show light-grey border matching required border geometry: yes/no
- Required field red → light-grey after fill + blur: yes/no
- Optional field border never changes color: yes/no
- Fonts unified (size/family/color) for placeholder, typing, filled, dropdown options: yes/no
- Dropdown anchoring/size/animation unchanged: yes/no
- Field order/layout unchanged: yes/no
- Validation/flash/shake behavior unchanged: yes/no
- Sticky counter / keyboard / bottom nav behavior unchanged: yes/no
- Saved editor (`/shipments/$id/products`) untouched: yes/no
- Typecheck clean: yes/no

## Stop conditions

- If unifying a specific field requires editing a shared primitive (e.g. shadcn `Input`), I stop and report instead of widening scope.
- If a CSS-only rule cannot reach a field because its root element is rendered by a shared component without a stable selector inside `.shipment-create-screen`, I stop and report — no shared-component edit without approval.

## Confirmation

Yes — all four rules are technically feasible within the visual-only safe scope described above. Awaiting approval to switch to Build.

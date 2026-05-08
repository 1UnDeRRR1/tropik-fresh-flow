## Plan: Simplify & reorder New Shipment form

File: `src/routes/_authenticated/shipments/new.tsx`

### 1. Remove visual noise
- In `PageHeader`, drop the subtitle `"Авто = країна завантаження. Один вантаж — одна країна."` — keep title only.
- Remove the helper line under country: `"Дефолт із постачальника, але редагується вручну."`
- Remove the helper line under vehicle picker: `"Оберіть країну, щоб відфільтрувати авто."`

### 2. Keep top action toggle
- Keep the two buttons: `+ НОВЕ АВТО` and `ДО ВІДКРИТОГО` (already correct).

### 3. New field order (mode = `new`)
Reorder JSX blocks to match exactly:
1. Постачальник (combobox) — moved to first
2. Країна завантаження (combobox) — auto-filled from supplier default country, still editable; in existing mode used to filter vehicles
3. Номер поставки (auto-generated, editable override) — moved up before dates
4. Дата завантаження (date input)
5. Розрахункова дата прибуття (computed read-only preview)
6. Submit button — relabel to `СТВОРИТИ ТА ПЕРЕЙТИ ДО ТОВАРІВ`

For mode = `existing`, show the vehicle picker right after Постачальник; country, code, dates come from the selected vehicle (read-only preview), then the same submit button.

### 4. Logic kept as-is
- Supplier → country auto-fill (already implemented via `useEffect` with `countryTouched` guard).
- Code auto-generation `COUNTRY_CODE + sequence + SUPPLIER_CODE` (already implemented; sequence resolved at submit).
- ETA = loading_date + country logistics days with weekend adjustment (already implemented via `calcArrivalDate`).
- Submit handler unchanged — only the button label changes.

### 5. Submit button label
Change current `Створити поставку` (line ~430-ish) to `СТВОРИТИ ТА ПЕРЕЙТИ ДО ТОВАРІВ`.

No DB / business-logic changes. Pure UI reorder + label/text cleanup.

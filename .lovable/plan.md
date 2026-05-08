## Поставки / авто — фінальна логіка (із розмежуванням ролей)

### Доступ до workflow авто
**Лише ролі `import_manager`, `admin`, `super_admin` (= `is_staff`)** можуть:
- бачити список відкритих авто;
- створювати нове авто;
- додавати постачальника до відкритого авто;
- продовжувати часткове завантаження;
- закривати/редагувати авто.

**Філіали (`branch`)** НЕ бачать:
- сторінку «Відкриті авто»;
- workflow завантаження авто;
- форму створення/додавання постачальника.

Філіал бачить тільки:
- свої розподіли (`distributions` де `branch_id = user_branch_id`);
- свої запити (`branch_requests`);
- трансфери (`transfer_requests`);
- ETA по своїх поставках;
- операційні дані філії.

---

### A. Модель даних

**Міграція БД:**

Нова таблиця `vehicles`:
- `id uuid pk`
- `code text unique` — `GR29`
- `country text` (українська), `country_code text` (`GR/IT/NL/...`)
- `sequence_no int`
- `loading_date date`, `eta date`, `logistics_days int`
- `status` enum `open | closed`
- `closed_at`, `closed_by uuid`, `created_by uuid`, `created_at`, `updated_at`

`shipments`:
- `+ vehicle_id uuid references vehicles(id)`
- `code` = `vehicle.code + '-' + supplier_code` (напр. `GR29-OLI`)

**RLS на `vehicles`:**
- `SELECT`: `is_staff(auth.uid())` — тільки staff (НЕ філіали).
- `INSERT/UPDATE`: `is_staff(auth.uid())`.
- Філіали взагалі не отримують доступу.

**RLS на `shipments` (оновлення):**
- `UPDATE/DELETE shipments`/`shipment_items` — лише `created_by = auth.uid()` АБО `is_admin(auth.uid())`. Інший import-manager може лише `INSERT` нового shipment у відкрите авто, не правлячи чужі блоки.
- Філіали — як зараз: `SELECT` тільки через свої distributions.

**Функції/тригери:**
- `next_vehicle_sequence(p_country text) returns int` — `max(sequence_no)+1` для країни.
- `recompute_vehicle_totals()` — тригер на `shipment_items` INSERT/UPDATE/DELETE: рахує палети/вагу авто, при `pallets >= 26 OR weight >= 21500 OR (26 - pallets) <= 1` → `status='closed'`, `closed_at=now()`.
- Backfill: для існуючих shipments створити `vehicles` (по країні+`created_at`), проставити `vehicle_id`, зберегти поточні `code`.

---

### B. Логіка нумерації
- `COUNTRY_CODE`: `Греція→GR, Італія→IT, Іспанія→ES, Нідерланди→NL, Бельгія→BE, Польща→PL, Молдова→MD, Албанія→AL, Македонія→MK`.
- `SUPPLIER_CODE`: 3 латинські літери з назви постачальника (UPPER, транслітерація кирилиці).
- `vehicle.code = COUNTRY_CODE + LPAD(sequence_no, 2)` → `GR29`.
- `shipment.code = vehicle.code + '-' + SUPPLIER_CODE` → `GR29-OLI`.
- Відображення multi-supplier авто: `GR29-OLI-APO` — обчислюється з агрегації shipments для перегляду.

---

### C. UI: створення поставки (`/shipments/new`) — staff-only

Форма (mobile-first, одна колонка):

**Крок 1 — Авто:**
- Toggle: `[Нове авто]` / `[Додати до відкритого]`.
- «Додати до відкритого» → searchable combobox (`Command` + `Popover`) зі списком `vehicles where status='open'`, фільтр за обраною країною. Кожна картка: код, країна, постачальники, палети `X/26`, вага `Y / 21 500 кг`, залишок, ETA.
- «Нове авто»:
  - Combobox країни (тільки українські назви з `COUNTRY_DAYS`).
  - Дата завантаження → ETA через `calcArrivalDate`.
  - `sequence_no` → виклик `next_vehicle_sequence(country)` при сабміті.

**Крок 2 — Постачальник:**
- Searchable combobox постачальника.
- Автозаповнює країну (тільки якщо «Нове авто» і користувач не змінив вручну). Країна редагована — зміна перерахує `country_code`, `sequence_no`, `logistics_days`, ETA, `code`.
- Видно лише: дату завантаження + ETA. Поле «Днів логістики» приховане в operational UI (залишається в БД і admin-розділі).
- Поле `code` — read-only автоген з кнопкою «✎ Редагувати вручну».

**Submit:**
- «Нове авто» → `insert vehicles` + `insert shipments` з `vehicle_id`.
- «Додати до відкритого» → `insert shipments` з обраним `vehicle_id` (country/loading_date/eta з vehicle, read-only).
- Після створення → редірект на `/shipments/$id`.

---

### D. UI: список відкритих авто — staff-only

На `/shipments` зверху блок «Відкриті авто» (рендериться лише якщо `is_staff`):
- Картки: код, країна (UA), постачальники (badges), палети `X/26`, вага `Y / 21 500 кг`, залишок місткості, ETA, кнопки `[Додати постачальника]` `[Закрити авто]`.
- Філіали цей блок не бачать (умова в компоненті + RLS блокує запит).

---

### E. Дозволи в UI (cross-manager)
- На `/shipments/$id`: кнопки edit/delete на блоці постачальника видні лише `created_by` або admin. Чужі блоки — read-only.
- Закриття авто — будь-який staff. Переоткриття — лише admin.

---

### F. Локалізація
- Розширити `src/lib/countries.ts` (EN→UA + ISO + варіанти). Жодних англійських назв в operational UI.
- Перевірити сторінки де показується `country` (більшість уже через `toUaCountry`).

---

### G. Поза scope
- Авто-розподіл, аналітика маржі, AI-логістика, sales/accounting.
- Адмінська CRUD-сторінка для `vehicles` (за потреби — окрема задача).

---

## Зачеплені файли

**БД:**
- Нова таблиця `vehicles` + enum + RLS + функції/тригери.
- ALTER `shipments ADD vehicle_id`.
- Backfill існуючих shipments.

**Frontend:**
- `src/lib/countries.ts` — розширення.
- `src/lib/arrival.ts` — додати `COUNTRY_CODE`.
- `src/lib/shipment-code.ts` *(новий)* — `buildSupplierCode`, `formatVehicleCode`.
- `src/routes/_authenticated/shipments/new.tsx` — vehicle toggle, comboboxes, авторозрахунки. Доступ через перевірку ролі (редірект non-staff).
- `src/routes/_authenticated/shipments/index.tsx` — блок «Відкриті авто» лише для staff.
- `src/routes/_authenticated/shipments/$id.tsx` — приховати «Днів логістики», обмежити edit для не-власників, показати належність до vehicle.
- `src/routes/_authenticated/dashboard/branch.tsx` — без vehicle workflow (як є).

## Ризики
- Backfill порядок sequence — за `created_at` в межах країни.
- Поточні `code` зберігаються; нові генеруються за новою логікою.

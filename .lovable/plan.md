# План: статус «Розвантажено», блокування та архівація

## 1. БД (migration)

**`shipments` нові колонки:**
- `unloaded_at timestamptz` — момент переходу у «Розвантажено» (день після ETA).
- `cancelled_at timestamptz`, `cancelled_by uuid` — фіксація скасування.
- `archive_due_at timestamptz` — дедлайн архівації (для скасованих = +48г без неділі; для розвантажених = `unloaded_at + 7 днів`).

**Нова таблиця `cancelled_shipments_archive`:**
- `id`, `shipment_id`, `cancelled_at`, `cancelled_by`, `archived_at`, `snapshot jsonb` (поставка + позиції + розподіли + логістика + менеджер на момент скасування).

**Helper-функція `add_business_hours_excl_sunday(ts, hours)`** — додає години, пропускаючи неділю (з 00:00 нд по 00:00 пн час «зупиняється»).

**Триггер на `shipments` UPDATE:**
- Коли `status` стає `cancelled` → проставити `cancelled_at = now()`, `cancelled_by = auth.uid()`, `archive_due_at = add_business_hours_excl_sunday(now(), 48)`.
- Коли `pipeline_status` стає `unloaded` (або через автоперехід) → `unloaded_at = now()`, `archive_due_at = unloaded_at + interval '7 days'`.

**RLS / блокування редагування** (replace policies):
- `shipments owner/logistics/broker UPDATE`: додати умову `unloaded_at IS NULL AND status <> 'cancelled'` (admin без обмежень).
- Аналогічно для `shipment_items`, `distributions`, `distribution_items`, `branch_transfer_offers`, `manager_offers` — блок на UPDATE/INSERT/DELETE якщо батьківська поставка розвантажена або скасована (admin виключення).

## 2. Cron (pg_cron + TanStack route)

**Route:** `src/routes/api/public/hooks/shipments-lifecycle.ts` — викликається щогодини:
1. **Auto-unload:** `UPDATE shipments SET pipeline_status='unloaded', unloaded_at=now(), archive_due_at=now()+interval '7 days' WHERE eta < CURRENT_DATE AND unloaded_at IS NULL AND status NOT IN ('cancelled')`.
2. **Archive cancelled:** для всіх `status='cancelled'` з `archive_due_at <= now()` → INSERT snapshot у `cancelled_shipments_archive`, позначити archived.
3. **Archive unloaded:** для `unloaded_at IS NOT NULL AND archive_due_at <= now()` → перевести у архів (прапор `archived_at`).

Cron schedule: `0 * * * *`.

## 3. Frontend

**Спільний тумблер `<MainBoardToggle active|unloaded />`** зверху над кожним головним табло:
- Менеджер/Адмін → `src/routes/_authenticated/shipments/index.tsx`: фільтр `unloaded_at IS NULL` vs `IS NOT NULL AND archived_at IS NULL`.
- Філія → `src/routes/_authenticated/branch/...` (підтверджений товар): аналогічно по distributions/shipment.
- Логістика → `src/routes/_authenticated/logistics.tsx`: додати таб.

**Менеджер: блок «Скасувати поставку»** — при скасуванні викликає server fn `cancelShipment.functions.ts` що:
- Перевіряє права, ставить `status='cancelled'`, тригер сам заповнить cancelled_at/by/archive_due_at.

**Сторінка `/archive`** (нова, доступна всім ролям read-only):
- Вкладки: «Розвантажено-архів» / «Скасовано-архів».
- Скасовано показує snapshot з `cancelled_shipments_archive` + `cancelled_by` (full_name) + час скасування.
- Жодних кнопок дії; усі форми у режимі `readOnly`.

**Картка поставки (drawer):** якщо `unloaded_at IS NOT NULL` або `status='cancelled'` і користувач не admin — усі інпути `disabled`, кнопки збереження прибрані, банер угорі: «Поставка розвантажена/скасована — редагування заблоковано».

## 4. Технічні деталі

- Логіка «без неділі» в SQL: рахуємо години підряд, якщо потрапили на діапазон [Sunday 00:00 .. Monday 00:00) — додаємо +24г.
- Snapshot будуємо через `jsonb_build_object` з джойнами по `shipment_items`, `distributions`, `distribution_items`.
- Тригер блокування реалізуємо через окремий `BEFORE UPDATE` тригер що RAISE EXCEPTION якщо `OLD.unloaded_at IS NOT NULL OR OLD.status='cancelled'` і користувач не admin (`is_admin(auth.uid())`). Це гарантує захист незалежно від RLS.
- Хук pg_cron реєструється через `supabase--insert` після деплою route.

## 5. Послідовність робіт

1. Migration: колонки + helper-функція + триггери блокування + таблиця архіву.
2. Cron route + реєстрація pg_cron.
3. Server fn `cancelShipment` + кнопка у UI.
4. Тумблер головного табло (3 сторінки).
5. Сторінка `/archive` з двома вкладками.
6. Disabled-режим картки поставки.

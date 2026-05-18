## Філія → «Підтверджений товар»: нова структура таблиці, трекер змін, кольори Переказ

### 1. База даних (одна міграція)

**Нова таблиця `branch_distribution_baselines`** — baseline на момент «ідентифікації філії з товаром»:
```
branch_id, distribution_id, shipment_item_id (PK),
identified_at      timestamptz  -- момент першої "ідентифікації"
baseline_eta       date
baseline_pallets   numeric
baseline_cost_ind  numeric
baseline_cost_inv  numeric
seen_eta, seen_pallets, seen_cost_ind, seen_cost_inv -- останнє «переглянуто» філією
updated_at
```
RLS: `branch_id = user_branch_id(auth.uid())` read/update; staff/admin — все.

**Тригери авто-створення baseline** (identified_at = now, baseline_* = поточні значення) при події:
- `INSERT` у `distributions` → для кожного нового `distribution_items` ряду створити baseline
- `INSERT` у `distribution_items` (додавання товару у вже існуючий розподіл)
- `UPDATE` `manager_offer_responses.approved_pallets` (фактично пропозиція менеджера прийнята та зарезервовано пали — використаємо момент створення відповідного `distribution_items.reserved_offer_id`)
- `UPDATE` `branch_transfer_offers.status='accepted'` → baseline для приймаючої філії
- `UPDATE` `branch_requests.status='approved'` → baseline для філії-запитувача

На практиці всі ці події в кінцевому підсумку матеріалізуються у `distribution_items`, тож тригер на `INSERT distribution_items` покриває 95%. Інші 5% — додамо явні тригери на acceptance, щоб identified_at був точним.

**RPC `branch_ack_changes(distribution_id, shipment_item_id)`** — оновлює `seen_*` поточними значеннями для філії викликача (через `auth.uid()`).

### 2. Дашборд філії (`src/routes/_authenticated/dashboard/branch.tsx`)

Нова структура колонок (sticky 1-а):
```
| Статус (sticky) | ETA | Поставка | Товар | Палет | Собівартість | Відп. менеджер |
```

- `Статус` — кольоровий чіп з `distribution.status` (planned / dispatched / received).
- `ETA`, `Палет`, `Собівартість` — якщо значення ≠ `seen_*` baseline → справа `⚠️ зміни` (жовтий). Кнопка кліку → невеликий popover: «Було: X → Стало: Y» + автоматично визначеною датою останньої зміни. При закритті popover викликаємо `branch_ack_changes` → іконка зникає.
- `Поставка` / `Товар` — клік відкриває HoverCard/Popover з: бренд, клас, сорт (variety), калібр, упаковка (packaging), країна, постачальник, темп. режим.
- `Відп. менеджер` — `import_managers.full_name` з shipment.

Сітка: на мобілці (вже видно 440px) — горизонтальний скрол, перша колонка `sticky left-0 bg-card`. Поточний drill-down sheet залишаємо для тапу по строці у вільних місцях.

### 3. Нові поля `brand`, `class` у `shipment_items`

Додаємо `brand text`, `class text` колонки. UI редагування — у формі товару поставки (`src/routes/_authenticated/shipments/$id.products.tsx`) додаємо два інпути. Попап на дашборді показує їх, якщо заповнені.

### 4. Сторінка Переказ — кольори вкладок та лічильників

У `src/routes/_authenticated/offers.tsx` (або де табси Вхідні/Відправлені):
- Вхідні: фон/текст активної вкладки — мʼяко-жовтий (`bg-yellow-100 text-yellow-900` або через токен `--accent-warning-soft`); badge — жовтий.
- Відправлені: мʼяко-блакитний (`bg-sky-100 text-sky-900`); badge — блакитний.

У `MainBoardToggle` чи у нижній навігації — НЕ чіпаємо (за вашою відповіддю — лічильники лишаються тільки на /offers).

### 5. Технічні деталі

- Лічильник змін у строці = кількість полів де `current ≠ seen_*` (показуємо ⚠️ біля кожного поля окремо, як ви і просили).
- Зміна статусу `distribution.status` — НЕ враховується у лічильнику (по вашому уточненню). Тригерів на status не ставимо.
- Якщо baseline відсутній (старі записи) — створимо backfill: для всіх існуючих `distribution_items` поставимо `identified_at = distributions.created_at`, baseline = поточним значенням, seen = baseline (нічого не світиться).
- Realtime: підписку на `branch_distribution_baselines` додавати не треба — рендер реагує на зміни `shipments`/`distribution_items` через існуючий invalidation.

### 6. Що НЕ роблю у цьому кроці
- Не змінюю нижню навігацію (`AppShell.tsx`) — за вашою відповіддю.
- Не додаю історію всіх змін (журнал) — popover показує лише останню різницю baseline↔current.
- Не редагую табло менеджера/логістики/адміна — запит стосується лише дашборду філії та табів Переказ.

Підтверджуєте — починаю з міграції БД, потім код?

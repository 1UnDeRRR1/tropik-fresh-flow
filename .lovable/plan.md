# Пропозиції менеджерів ЗЕД філіям

Новий процес збору попиту до створення поставки. Існуючі потоки (заявки філій на нерозподілений товар, переказ між філіями, розподіл поставок) лишаються без змін.

## 1. База даних (нова міграція)

**Таблиця `manager_offers`** (пропозиції менеджера):
- `id`, `created_at`, `updated_at`
- `created_by` (uuid → auth.users) — власник-менеджер
- `import_manager_id` (uuid → import_managers, для відображення)
- `product_name`, `origin_country`, `caliber`, `packaging`, `specification`, `variety`
- `indicative_cost_usd` (numeric, manual), `invoice_cost_usd` (numeric, manual)
- `prev_indicative_cost_usd`, `prev_invoice_cost_usd` (для підсвітки змін)
- `offered_pallets` (numeric, nullable)
- `expires_at` (timestamptz, nullable) — таймер
- `status` enum `manager_offer_status`: `draft|active|in_work|confirmed|linked|closed|expired|deleted`
- `linked_shipment_id` (uuid → shipments, nullable)
- `notes`

**Таблиця `manager_offer_responses`** (відгуки філій):
- `id`, `created_at`, `updated_at`
- `offer_id` (uuid → manager_offers)
- `branch_id` (uuid → branches)
- `requested_pallets` (numeric) — те, що ввела філія
- `approved_pallets` (numeric, nullable) — коригування менеджера
- `prev_approved_pallets` (numeric, nullable) — для підсвітки
- UNIQUE (offer_id, branch_id)

**Enum + RLS:**
- Менеджер бачить/редагує лише свої offers (`created_by = auth.uid()` або admin).
- Філія бачить активні offers (status `active|in_work|confirmed|linked`) та власні `manager_offer_responses`.
- Філія створює/оновлює лише свій `response` (branch_id = user_branch_id).
- Менеджер бачить усі responses до власних offers; admin/super_admin — всі.

**Функція `expire_manager_offers()`** — переводить `active` → `expired` коли `expires_at < now()`.

**Тригер для авто-розподілу при linking:**
Коли offer переходить у `linked` зі заповненим `linked_shipment_id`, для кожного response з `approved_pallets > 0` створюється/оновлюється `distributions` + `distribution_items` для відповідної філії та `shipment_item` (за match-логікою product+country+caliber+packaging+specification+variety).

## 2. Маршрути (нові route-файли)

- `src/routes/_authenticated/manager-offers.tsx` — сторінка менеджера ЗЕД «Запропонувати»
  - Список власних offers з фільтрами по статусу
  - Кнопка «Створити пропозицію» → діалог з усіма полями
  - Кожен offer розгортається: список відгуків філій з можливістю редагувати approved_pallets
  - Кнопки переходу статусу: Активувати, Взяти в роботу, Підтвердити, Закрити, Видалити
  - Підсвітка перевищення попиту: `offered/total` червоним, якщо total > offered
- `src/routes/_authenticated/branch-offers.tsx` — сторінка філії «Пропозиції»
  - Список активних offers від усіх менеджерів
  - Інпут «запитати палети» + Send
  - Колонка статусу з власним requested/approved + дельта (червоне/зелене)
  - Підсвітка зміни вартості: old → new з кольором
  - ETA, якщо linked

**Меню (`AppShell`):**
- import_manager → додати пункт «Запропонувати» (`/manager-offers`)
- branch → додати пункт «Пропозиції» (`/branch-offers`)
- admin/super_admin → пункт «Пропозиції (всі)» що веде на `/manager-offers` (бачить всі)

## 3. Інтеграція з поставкою

В `src/routes/_authenticated/shipments/$id.products.tsx` (чи де додаються позиції):
- Після введення product/country/caliber/packaging/specification/variety виконується query `manager_offers` зі статусом `active|in_work|confirmed` і відповідними полями.
- Якщо знайдено match → діалог: «Створити як новий товар чи прив’язати до існуючої пропозиції?» з кнопками «Створити як новий» і «Прив’язати».
- При «Прив’язати»: оновити offer.status='linked', offer.linked_shipment_id, прив’язати offer.id до shipment_item (нова nullable колонка `shipment_items.linked_offer_id`). Тригер створює розподіли.

## 4. Логіка підсвітки

- Кошти: порівнюємо `indicative_cost_usd` vs `prev_indicative_cost_usd` — нижче=зелене, вище=червоне.
- Палети: `approved_pallets` vs `requested_pallets` — нижче=червоне, вище=зелене.
- Сумарний попит: `SUM(approved_pallets) > offered_pallets` → червона підсвітка `20/27`.

## 5. Файли, що змінюються/створюються

Створюються:
- supabase migration (таблиці, enum, RLS, функції, тригери)
- `src/routes/_authenticated/manager-offers.tsx`
- `src/routes/_authenticated/branch-offers.tsx`
- `src/components/ManagerOfferDialog.tsx` (форма create/edit)
- `src/components/OfferShipmentLinkDialog.tsx` (діалог prompt при додаванні товару)

Редагуються:
- `src/components/AppShell.tsx` — пункти меню за роллю
- `src/routes/_authenticated/shipments/$id.products.tsx` — детект match + prompt

## 6. Обмеження

- Закупівельні ціни постачальника філіям не показуємо — на сторінці філії лише `indicative_cost_usd`/`invoice_cost_usd`.
- Філія бачить лише свій response.
- Існуючі `branch_requests`, `branch_transfer_offers`, `distributions` залишаються незмінними.

Після затвердження плану я виконаю міграцію БД першим кроком, потім UI.

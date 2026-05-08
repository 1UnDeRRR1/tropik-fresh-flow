
## Мета

Привести бекенд Lovable Cloud у відповідність до вашого списку сутностей:
`users, roles, branches, suppliers, shipments, shipment_items, distributions, branch_requests, transfer_requests, notifications, trigger_logs` — без втрати поточних даних і RLS. UI лишається українською.

## Що змінюється у БД (одна міграція)

1. **Перейменування таблиць**
   - `transfers` → `transfer_requests`
   - `transfer_items` → `transfer_request_items` (для узгодженості з новою назвою)
   - `audit_logs` → `trigger_logs`

2. **Нова таблиця `branch_requests`** — заявки філії на товар із поставки:
   - `branch_id` (→ branches), `shipment_id` (→ shipments, nullable — заявка може бути без прив'язки)
   - `status` enum: `pending | approved | rejected | fulfilled | cancelled`
   - `requested_by` (auth user), `notes`, `created_at`, `updated_at`
   - Дочірня `branch_request_items`: `product_name`, `qty`, `unit`

3. **RLS** для нових/перейменованих таблиць — за тією ж моделлю:
   - філія бачить/створює тільки власні `branch_requests`;
   - персонал (`is_staff`) має повний доступ;
   - `trigger_logs` — читає лише `super_admin`, пише будь‑який автентифікований staff.

4. **Сумісність назв**: `users` і `roles` зі списку = існуючі `profiles` + `user_roles` (стандарт Supabase, перейменовувати не варто, бо `auth.users` зарезервовано). У UI підписуємо їх як «Користувачі» та «Ролі».

## Що змінюється у коді

- Оновити запити Supabase, що використовують `transfers` / `transfer_items` / `audit_logs`, на нові імена (типи `src/integrations/supabase/types.ts` згенеруються автоматично після міграції).
- Сторінка `/transfers` — лишається тією ж URL, але працює з `transfer_requests`.
- Додати маршрут `/_authenticated/branch-requests` (список + форма створення для філії, апрув/відхилення для staff).
- Додати пункт «Заявки» (branch_requests) у нижню навігацію для ролі `branch` і у меню staff.
- Сторінка `/_authenticated/dashboard/super-admin` — підключити перегляд `trigger_logs`.

## UI (українською)

Назви розділів: «Користувачі», «Ролі», «Філії», «Постачальники», «Поставки», «Позиції поставки», «Розподіл», «Заявки філій», «Міжфілійні переміщення», «Сповіщення», «Журнал подій».

## Технічні деталі

```
БД:
  ALTER TABLE transfers       RENAME TO transfer_requests;
  ALTER TABLE transfer_items  RENAME TO transfer_request_items;
  ALTER TABLE audit_logs      RENAME TO trigger_logs;
  CREATE TYPE branch_request_status AS ENUM (...);
  CREATE TABLE branch_requests (...);
  CREATE TABLE branch_request_items (...);
  + RLS policies + updated_at trigger
```

Поза скоупом цього кроку: realtime, експорт, завантаження документів — лишаємо на наступні ітерації.


# TROPIK Supply Distribution — MVP план

Мобільно-орієнтований внутрішній веб/PWA для управління імпортом і розподілом фруктів та овочів. Інтерфейс — українською. Дизайн: чисто, премʼюм, мінімалістично, оптимізовано під iPhone.

## Бренд та стиль

- **Кольори**: білий фон, темно-синій (`#0B1B3B` основний), червоний акцент TROPIK (`#E11D2A`), мʼякі сірі для роздільників.
- **Типографіка**: Inter або SF-style sans (через `space-grotesk-dm-sans` пресет), великі заголовки, чіткі ваги.
- **Компоненти**: картки з мʼякими тінями, скруглення `xl`, мобільна нижня навігація (bottom tab bar) для основних ролей, sticky хедер з логотипом і дзвіночком сповіщень.
- **Логотип**: ви завантажите файл — поки використаємо тимчасовий wordmark `TROPIK` (червона крапка над `i`), легко замінимо.

## Ролі та доступ

4 ролі через `user_roles` + `has_role()` (security definer):
1. **Super Admin** — усе + логи, дозволи, керування постачальниками.
2. **Admin** — повний операційний доступ + аналітика + користувачі.
3. **Import Manager** — постачальники, поставки, розподіл, калькуляція собівартості.
4. **Branch** — лише свої поставки/трансфери, статуси.

Після логіну — редірект на дашборд відповідно до ролі.

## Структура маршрутів (TanStack Start)

```text
/login                           публічний
/_authenticated/                 захищений layout (bottom nav)
  ├── index                      авто-редірект за роллю
  ├── dashboard/manager          Import Manager dashboard
  ├── dashboard/branch           Branch dashboard
  ├── dashboard/admin            Admin dashboard
  ├── dashboard/super-admin      Super Admin
  ├── shipments                  список поставок (картки/фільтри)
  ├── shipments/$id              деталі + статус-таймлайн
  ├── shipments/new              нова поставка
  ├── distribution               розподіл по філіях
  ├── distribution/$shipmentId   майстер розподілу
  ├── costs                      калькуляція собівартості
  ├── suppliers                  постачальники
  ├── suppliers/$id              картка постачальника
  ├── transfers                  трансфери між філіями
  ├── analytics                  графіки і KPI
  ├── notifications              стрічка сповіщень
  └── settings                   профіль, мова, вихід
```

## Lovable Cloud — схема БД (MVP)

- `profiles` (id → auth.users, full_name, branch_id, phone, avatar_url)
- `branches` (id, name, city, address, manager_name)
- `app_role` enum: `super_admin | admin | import_manager | branch`
- `user_roles` (user_id, role) + `has_role()` security definer
- `suppliers` (id, name, country, contact, rating, notes)
- `shipments` (id, code, supplier_id, status, eta, arrived_at, total_weight_kg, currency, fx_rate, customs_cost, logistics_cost, other_costs, created_by)
- `shipment_items` (id, shipment_id, product_name, sku, qty, unit, unit_price, weight_kg)
- `distributions` (id, shipment_id, branch_id, status, dispatched_at, received_at)
- `distribution_items` (id, distribution_id, shipment_item_id, qty, unit_cost)
- `transfers` (id, from_branch_id, to_branch_id, status, created_by, created_at)
- `transfer_items` (id, transfer_id, product_name, qty, unit)
- `notifications` (id, user_id, type, title, body, read_at, link)
- `audit_logs` (super admin) — id, actor_id, action, entity, entity_id, payload, created_at

Статуси поставки: `draft → in_transit → customs → arrived → distributing → completed`.

RLS: усе обмежено через `has_role()` та `branch_id` користувача.

## Ключові екрани MVP

1. **Login** — email/password + Google, логотип, темно-синій фон з червоним акцентом.
2. **Manager Dashboard** — KPI картки (активні поставки, у дорозі, на митниці, до розподілу), список найближчих ETA, швидка дія «+ Нова поставка».
3. **Branch Dashboard** — «Мої вхідні поставки», «Очікують прийому», «Трансфери», кнопка «Запит трансферу».
4. **Admin Dashboard** — загальні KPI, останні події, список користувачів.
5. **Super Admin** — додатково: ролі, журнал дій, керування постачальниками.
6. **Shipments list** — фільтри (статус, постачальник, дата), картки з кодом, прапором країни, ETA, статус-чіпом.
7. **Shipment detail** — таймлайн статусу, позиції, вкладені вкладки: Позиції / Витрати / Розподіл / Документи.
8. **Distribution wizard** — вибір поставки → таблиця «позиція × філія» з кількостями → підтвердження.
9. **Cost calculation** — авто-розрахунок собівартості одиниці: `(сума товарів + митниця + логістика + інше) × курс / кількість`, розбивка по позиціях.
10. **Suppliers** — картки з рейтингом, кількістю поставок, середнім лід-таймом.
11. **Transfers** — список + форма «з філії → у філію».
12. **Analytics** — графіки (recharts): обсяги по місяцях, топ постачальники, розподіл по філіях, середня собівартість.
13. **Notifications** — стрічка з типами (нова поставка, статус змінено, трансфер тощо), мітка «прочитано».

## PWA (manifest only)

- `public/manifest.webmanifest` з `display: standalone`, theme color `#0B1B3B`, background `#FFFFFF`.
- Іконки 192/512 (тимчасові з логотипу), apple-touch-icon.
- Без service worker — щоб не ламати прев'ю.

## Що буде в цьому MVP-кроці

- Lovable Cloud увімкнено, схема БД + RLS.
- Auth (email/password + Google), `_authenticated` layout, ролі.
- Усі маршрути зі скелетною UI: реальні форми/таблиці на головних екранах (поставки, розподіл, постачальники), мок-дані-сіди для демонстрації.
- Дизайн-система (tokens у `styles.css`), мобільна нижня навігація, sticky header.
- Тимчасовий логотип-wordmark — підмінимо на ваш файл після завантаження.
- PWA manifest.

## Що залишимо на наступні ітерації

- Реальні сповіщення в реальному часі (Supabase Realtime).
- Експорт у Excel/PDF.
- Завантаження документів поставки (інвойси, CMR) у Storage.
- Детальний журнал аудиту з фільтрами.
- Багатовалютність з історією курсів.

Натисніть **Implement plan**, щоб почати збірку. Після створення скелета — завантажте, будь ласка, логотип TROPIK у чат, і я підміню його скрізь.

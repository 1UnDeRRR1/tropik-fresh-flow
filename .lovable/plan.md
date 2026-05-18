# Сквозной статус "Status Pipeline"

Создаём единую систему статусов, которая сопровождает товар от пропозиції менеджера до прибуття на склад. Виден всем ролям (менеджер, філія, логіст, адмін, брокер) в их таблицях.

## 1. Модель данных (миграция)

Добавляем единый enum `pipeline_status`:

```text
proposed          → Запропоновано
processing        → В опрацюванні
ordered           → Замовлено
awaiting_loading  → Чекає завантаження
loading           → Завантаження
in_transit        → В дорозі
at_customs        → На митниці
left_customs      → Виїхала на склад
at_warehouse      → На складі
```

Изменения:
- `manager_offers.pipeline_status` — статус позиції (proposed → processing).
- `shipments.pipeline_status` — статус поставки (ordered → at_warehouse).
- `shipment_items` наследуют статус поставки (отображается, не хранится отдельно — либо хранится для истории).
- Новое поле `shipments.left_customs_at timestamptz` (для брокера).
- Новая роль в `app_role` enum: `broker`.

Триггеры/функции БД для автоматики:
- При `INSERT manager_offers` (active) → `pipeline_status='proposed'`.
- При `UPDATE manager_offers.status='closed'` → `processing`.
- При `manager_offers.linked_shipment_id` set → `ordered` (наследует shipment).
- При создании shipment → `ordered`.
- Когда у shipment заполнены `vehicle_plate`/`driver_name` И `loading_address`/`loading_reference` → `awaiting_loading`.
- Когда `loading_date = today` → `loading` (cron daily).
- На следующий день после `loading_date`, если статус остался `loading` → `in_transit` (cron daily).
- `at_customs` / `left_customs` / `at_warehouse` — ручные.

## 2. RLS / роль брокера

- Добавить `broker` в `app_role`.
- Брокер: `SELECT` shipments + `UPDATE pipeline_status` только из `in_transit` → `at_customs` → `left_customs`.
- В is_staff() брокера НЕ включаем (ограниченный доступ).

## 3. UI компонент `<PipelineStatusBadge />`

Один компонент с пропсами `status`, `size`, `variant`.

Цвета (спокойные, oklch токены в `src/styles.css`):
- proposed — soft slate
- processing — soft amber
- ordered — soft indigo
- awaiting_loading — soft teal
- loading — soft violet (анимация — pulse)
- in_transit — soft blue (иконка машинки, лёгкое движение)
- at_customs — soft orange
- left_customs — soft cyan
- at_warehouse — soft emerald (галочка)

### Стили визуализации (для демо — выбор пользователя)

Создаём страницу `/admin/status-preview` где показаны ВСЕ 9 статусов в 4 вариантах:
1. **Minimal** — плоский чип с иконкой, без анимации.
2. **Soft glow** — чип с лёгким свечением соответствующего цвета.
3. **Animated icon** — иконка с микро-анимацией (грузовик едет, спиннер загрузки, пульс).
4. **Pill + progress** — чип с тонкой progress-полоской снизу, показывающей этап в пайплайне (1/9 … 9/9).

После выбора оставляем один стиль, остальные удаляем.

## 4. Отображения в таблицах

### Менеджер — `/shipments`
- Колонки `Номер` и `Статус` делаем `sticky left-0` (закреплены при горизонтальном скролле).
- Статус берётся из `shipments.pipeline_status`.

### Філія — `/branch-offers` (і поставки філії)
- Порядок колонок: Товар → Статус → Кількість → Номер поставки → Вхідна ціна → Індикативні.
- Без sticky.

### Логіст — `/logistics`
- Добавляем колонку Статус (pipeline) рядом с logistics_status (или заменяем — уточнить позже).

### Адмін — `/admin` поставки
- Аналогично менеджеру, sticky номер+статус.

### Брокер
- Окреме табло `/broker` зі списком shipments у статусах `in_transit`/`at_customs` і кнопками «На митниці» / «Виїхала на склад».

## 5. Ручне змінення

Dropdown у бейджа статусу (тільки для менеджера-власника поставки / логіста / адміна) — дозволяє переключити на будь-який статус ≥ поточного. Брокер — лише дві кнопки.

## 6. Cron (pg_cron + pg_net)

Щодня о 00:30 викликаємо `/api/public/hooks/advance-pipeline`:
- ставить `loading` коли настав день;
- ставить `in_transit` на наступний день після loading_date.

## Технічні деталі

- Файли: 
  - migration (enum, колонки, тригери, RLS, роль broker, cron job).
  - `src/lib/pipeline-status.ts` (labels, color tokens, icons, order).
  - `src/components/PipelineStatusBadge.tsx` (з 4 варіантами через prop `variant`).
  - `src/components/PipelineStatusSelect.tsx` (ручна зміна).
  - `src/routes/_authenticated/admin/status-preview.tsx` (демо-страница).
  - `src/routes/_authenticated/broker.tsx` (нова роль).
  - Update: `shipments/index.tsx`, `branch-offers.tsx`, `logistics.tsx`, `manager-offers.tsx`.
  - Server route: `src/routes/api/public/hooks/advance-pipeline.ts`.

## План виконання

1. **Шаг 1 (цей PR):** міграція + бейдж + демо-сторінка `/admin/status-preview` з 4 стилями.
2. **Очікую від тебе вибір стилю.**
3. **Шаг 2:** інтегруємо обраний стиль у всі табло, додаємо роль брокера, cron, ручну зміну.

Так ми спочатку зафіксуємо візуал, потім розгорнемо логіку без переробок.

# План виправлень логіки статусів

## Що поламано і як виправити

### 1. Менеджер натиснув «Закрити» — у філії зникає рядок
**Зараз:** статус offer стає `closed`, тригер змінює pipeline на `processing`. У дашборді філії рядок із manager_offer_responses відображається як «В опрацюванні» — але якщо існує `distribution_items.reserved_offer_id` без `shipment_item_id`, materialized-фільтр викидає рядок.

**Виправлення (`dashboard/branch.tsx`):**
- Коли `manager_offers.status === 'closed'` і `approved_pallets > 0` → показувати pipeline = `confirmed`, лейбл «Підтверджено», з підсумком підтверджених палет.
- Не ховати pending-рядок через `materialisedOfferIds`, поки немає реального `shipment_item_id` у distribution_items (тобто товар без номера поставки).

### 2. Менеджер встановив approved = 0 (або «відмовив») — у Києва рядок зник
**Зараз:** UI менеджера дозволяє ввести 0 або null. При null → у філії «Чекаю підтвердження». При 0 → має бути «Відмовлено», але якщо `materialisedOfferIds` ховає → зникає.

**Виправлення:**
- У `branch.tsx` залишити pending-рядок з pipeline = `rejected`, лейбл «Відмовлено», коли `approved_pallets === 0`. Не ховати такі рядки фільтром materialized.
- Додати на UI менеджера явну кнопку «Відмовити» (ставить approved = 0), окрему від видалення.

### 3. Менеджер видалив усе предложення — у філій зникло
**Зараз:** статус стає `deleted`, дашборд філії не показує (бо інші частини логіки фільтрують).

**Виправлення:**
- У `dashboard/branch.tsx` для filed offers зі статусом `deleted`, у яких існує response від цієї філії → показувати рядок з pipeline = `rejected`, лейбл «Скасовано» (іконка XCircle, червоний тон).
- Не змінювати DB — `deleted` залишається, але UI відображає його як «Скасовано» для філії, що встигла зробити запит/отримати підтвердження.

### 4. Товар з номером поставки показує «Підтверджено» замість «Замовлено»
**Зараз:** у `branch.tsx` рядок pending з `o.linked_shipment_id` ставить pipeline = `confirmed`, лейбл «Підтверджено».

**Виправлення:**
- Замінити на pipeline = `ordered`, лейбл «Замовлено» — як тільки `linked_shipment_id` встановлено, статус = «Замовлено» для всіх. Подальший pipeline (loading, in_transit…) бере pipeline з самої shipment.

## Файли, що змінюються
- `src/routes/_authenticated/dashboard/branch.tsx` — переписати логіку у блоці pending offers (рядки 384–445): новий вибір pipeline залежно від `o.status` + `approved_pallets` + `linked_shipment_id`; розширити query на `status='deleted'` для рядків, де є response.
- `src/routes/_authenticated/branch-offers.tsx` — мапити `closed` → «Підтверджено» (а не «Скасовано») в активному списку, `deleted` → «Скасовано».
- `src/routes/_authenticated/manager-offers.tsx` — додати кнопку «Відмовити філії» (set approved=0) поряд з input підтвердження у діалозі деталей offer.

## Логіка нового мапінгу (для `branch.tsx`)

```text
if (o.status === 'deleted')           → rejected   / «Скасовано»
else if (o.linked_shipment_id)        → ordered    / «Замовлено»
else if (approved === null)           → awaiting_confirmation / «Чекаю підтвердження»
else if (Number(approved) <= 0)       → rejected   / «Відмовлено»
else if (o.status === 'closed')       → confirmed  / «Підтверджено» (фінал — менеджер закрив)
else                                  → processing / «В опрацюванні»
```

## БД
Змін у БД не потрібно. Усі статуси вже існують і коректно зберігаються; виправляється лише UI-мапінг та фільтрація рядків.

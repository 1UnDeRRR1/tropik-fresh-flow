
Режим: **Plan / Preview only.** Нічого не застосовуємо. Це оновлений Preview із усіма 13 поправками. Після нього зупиняємось і чекаємо явного дозволу на Build.

Підтверджено вашими рішеннями:
- Sensitive fields → **варіант A** (повний old/new, доступ лише `super_admin`).
- Scope → **INSERT / UPDATE / DELETE**.
- `actor_roles text[]` — усі ролі стабільно відсортовані.

---

## 1. Безпечний CASE для NEW/OLD і повернення з тригера

- AFTER-тригер має повертати `NULL` (значення NEW/OLD ігнорується для AFTER row-level — повертаємо `NULL` явно).
- Виклики `to_jsonb(NEW)` всередині гілки `TG_OP='DELETE'` і `to_jsonb(OLD)` всередині `TG_OP='INSERT'` неприпустимі (NEW/OLD `NULL`). Беремо проєкції лише в межах відповідної гілки:

```text
IF TG_OP = 'INSERT' THEN
  n_full := to_jsonb(NEW); o_full := NULL;
ELSIF TG_OP = 'DELETE' THEN
  n_full := NULL;          o_full := to_jsonb(OLD);
ELSE -- UPDATE
  n_full := to_jsonb(NEW); o_full := to_jsonb(OLD);
END IF;
```

`COALESCE(NEW.id, OLD.id)` зберігається (валідно для всіх трьох операцій).

---

## 2. Явні алиаси `AS t(k)` і пост-фільтрація

`jsonb_object_keys(...)` і `unnest(...)` завжди з явним алиасом і виключенням `updated_at`:

```text
SELECT COALESCE(array_agg(k ORDER BY k), ARRAY[]::text[])
  INTO changed
  FROM jsonb_object_keys(n_full) AS t(k)
 WHERE k <> 'updated_at'
   AND (n_full -> k) IS DISTINCT FROM (o_full -> k);
```

Для INSERT/DELETE — той самий патерн із виключенням `'updated_at'`, `'created_at'`, `'id'` зі списку (id і так у `shipment_id`):

```text
FROM jsonb_object_keys(n_full) AS t(k)
WHERE k NOT IN ('updated_at')
  AND (n_full -> k) IS NOT NULL AND (n_full -> k) <> 'null'::jsonb
```

Проєкції old/new по `changed`:

```text
SELECT COALESCE(jsonb_object_agg(k, n_full -> k), '{}'::jsonb)
  INTO n_proj
  FROM unnest(changed) AS t(k);
```

Порівняння завжди JSONB-значеннями (`-> k`), не `->> k` (типи зберігаються).

---

## 3. Grants на `shipment_changes` — service_role тільки SELECT

```sql
REVOKE ALL ON public.shipment_changes FROM PUBLIC, anon, authenticated, service_role;
GRANT  SELECT ON public.shipment_changes TO authenticated;   -- доступ гейтиться RLS
GRANT  SELECT ON public.shipment_changes TO service_role;    -- тільки читання
-- запис у таблицю — виключно через SECURITY DEFINER trigger function (owner=postgres).
-- INSERT/UPDATE/DELETE НЕ надаються нікому, RLS-policy теж відсутні для них.
```

`service_role` свідомо НЕ отримує `INSERT/UPDATE/DELETE`. Audit-таблиця immutable з точки зору будь-якого application path.

RLS:

```sql
ALTER TABLE public.shipment_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shipment_changes_select_super_admin"
  ON public.shipment_changes FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));
-- INSERT/UPDATE/DELETE policies — НЕМАЄ.
```

---

## 4. client_source / client_action / client_route — недовірений контекст

Перейменування в схемі підкреслює недовіру:

| Колонка | Джерело | Довіра |
|---|---|---|
| `client_source`  | header `x-audit-source`  | UNTRUSTED — клієнт може підмінити |
| `client_action`  | header `x-audit-action`  | UNTRUSTED |
| `client_route`   | header `x-audit-route`   | UNTRUSTED |
| `client_request_id` | header `x-request-id` | UNTRUSTED, лише для кореляції |
| `request_role`   | `current_setting('request.jwt.claims', true)::jsonb ->> 'role'` | TRUSTED (PostgREST) |
| `request_method` | `current_setting('request.method', true)`  | TRUSTED |
| `request_path`   | `current_setting('request.path',   true)`  | TRUSTED |
| `actor_id`       | `auth.uid()` | TRUSTED |
| `actor_roles`    | `user_roles` lookup за `auth.uid()` | TRUSTED |
| `txid`           | `txid_current()` | TRUSTED |

`super_admin` UI повинен явно маркувати `client_*` як «з клієнта, перевірці не підлягає».

---

## 5. Ліміти довжини header-полів (захист від abuse)

У тригері перед `INSERT`:

```text
client_source     := left(NULLIF(headers ->> 'x-audit-source', ''), 64);
client_action     := left(NULLIF(headers ->> 'x-audit-action', ''), 128);
client_route      := left(NULLIF(headers ->> 'x-audit-route',  ''), 256);
client_request_id := left(NULLIF(headers ->> 'x-request-id',   ''), 64);
```

Жодних `CHECK`-constraint на таблиці (зайва жорсткість на runtime), обрізаємо м'яко в тригері.

---

## 6. Fail-closed поведінка audit-тригера

Аудит — джерело істини. Якщо тригер не може записати — UPDATE shipments **повинен впасти**.

- Функція `public.log_shipments_changes()` НЕ обгортає `INSERT` у `BEGIN ... EXCEPTION WHEN OTHERS THEN ... END`. Будь-яка помилка піднімається наверх → транзакція UPDATE rollback'неться.
- Це явно зафіксовано в коментарі функції: `-- Fail-closed: any error here ABORTS the originating shipments mutation.`
- Наслідок: проблеми з audit видно одразу як помилки UI, а не як «тиха втрата сліду».

Альтернативу (fail-open `BEGIN ... EXCEPTION ... NULL`) свідомо **відкидаємо**.

---

## 7. Повний SQL міграції (Preview, **НЕ виконуємо**)

```sql
-- =========================================================
-- AUDIT INFRASTRUCTURE (без увімкнення тригера)
-- =========================================================
CREATE TABLE public.shipment_changes (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id         uuid        NOT NULL,
  op                  text        NOT NULL CHECK (op IN ('INSERT','UPDATE','DELETE')),
  actor_id            uuid,
  actor_roles         text[]      NOT NULL DEFAULT ARRAY[]::text[],
  changed_fields      text[]      NOT NULL,
  old_values          jsonb,
  new_values          jsonb,
  client_source       text,
  client_action       text,
  client_route        text,
  client_request_id   text,
  request_role        text,
  request_method      text,
  request_path        text,
  txid                bigint      NOT NULL DEFAULT txid_current(),
  created_at          timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.shipment_changes FROM PUBLIC, anon, authenticated, service_role;
GRANT  SELECT ON public.shipment_changes TO authenticated;
GRANT  SELECT ON public.shipment_changes TO service_role;

ALTER TABLE public.shipment_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shipment_changes_select_super_admin"
  ON public.shipment_changes FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE INDEX shipment_changes_shipment_created_idx
  ON public.shipment_changes (shipment_id, created_at DESC);
CREATE INDEX shipment_changes_request_idx
  ON public.shipment_changes (client_request_id) WHERE client_request_id IS NOT NULL;
CREATE INDEX shipment_changes_txid_idx
  ON public.shipment_changes (txid);
CREATE INDEX shipment_changes_actor_created_idx
  ON public.shipment_changes (actor_id, created_at DESC) WHERE actor_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.log_shipments_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  headers     jsonb := COALESCE(NULLIF(current_setting('request.headers',     true), '')::jsonb, '{}'::jsonb);
  claims      jsonb := COALESCE(NULLIF(current_setting('request.jwt.claims',  true), '')::jsonb, '{}'::jsonb);
  uid         uuid  := auth.uid();
  roles       text[];
  o_full      jsonb;
  n_full      jsonb;
  changed     text[];
  o_proj      jsonb;
  n_proj      jsonb;
BEGIN
  -- Fail-closed: any error here ABORTS the originating shipments mutation.

  IF TG_OP = 'INSERT' THEN
    n_full := to_jsonb(NEW); o_full := NULL;
  ELSIF TG_OP = 'DELETE' THEN
    n_full := NULL;          o_full := to_jsonb(OLD);
  ELSE
    n_full := to_jsonb(NEW); o_full := to_jsonb(OLD);
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(array_agg(k ORDER BY k), ARRAY[]::text[])
      INTO changed
      FROM jsonb_object_keys(n_full) AS t(k)
     WHERE k <> 'updated_at'
       AND (n_full -> k) IS DISTINCT FROM (o_full -> k);
    IF cardinality(changed) = 0 THEN
      RETURN NULL; -- no-op UPDATE (тільки updated_at) → запис не створюється
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    SELECT COALESCE(array_agg(k ORDER BY k), ARRAY[]::text[])
      INTO changed
      FROM jsonb_object_keys(n_full) AS t(k)
     WHERE k <> 'updated_at'
       AND (n_full -> k) IS NOT NULL AND (n_full -> k) <> 'null'::jsonb;
  ELSE -- DELETE
    SELECT COALESCE(array_agg(k ORDER BY k), ARRAY[]::text[])
      INTO changed
      FROM jsonb_object_keys(o_full) AS t(k)
     WHERE k <> 'updated_at'
       AND (o_full -> k) IS NOT NULL AND (o_full -> k) <> 'null'::jsonb;
  END IF;

  IF o_full IS NOT NULL THEN
    SELECT COALESCE(jsonb_object_agg(k, o_full -> k), '{}'::jsonb)
      INTO o_proj FROM unnest(changed) AS t(k);
  END IF;
  IF n_full IS NOT NULL THEN
    SELECT COALESCE(jsonb_object_agg(k, n_full -> k), '{}'::jsonb)
      INTO n_proj FROM unnest(changed) AS t(k);
  END IF;

  SELECT COALESCE(array_agg(role::text ORDER BY role::text), ARRAY[]::text[])
    INTO roles
    FROM public.user_roles WHERE user_id = uid;

  INSERT INTO public.shipment_changes(
    shipment_id, op, actor_id, actor_roles,
    changed_fields, old_values, new_values,
    client_source, client_action, client_route, client_request_id,
    request_role, request_method, request_path
  ) VALUES (
    COALESCE(NEW.id, OLD.id), TG_OP, uid, roles,
    changed, o_proj, n_proj,
    left(NULLIF(headers ->> 'x-audit-source', ''), 64),
    left(NULLIF(headers ->> 'x-audit-action', ''), 128),
    left(NULLIF(headers ->> 'x-audit-route',  ''), 256),
    left(NULLIF(headers ->> 'x-request-id',   ''), 64),
    NULLIF(claims ->> 'role', ''),
    NULLIF(current_setting('request.method', true), ''),
    NULLIF(current_setting('request.path',   true), '')
  );

  RETURN NULL; -- AFTER row-level: повертаємо NULL, значення ігнорується ядром
END
$fn$;

ALTER FUNCTION public.log_shipments_changes() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.log_shipments_changes()
  FROM PUBLIC, anon, authenticated;
-- Власник (postgres) і service_role можуть викликати; решта — лише через тригер.
```

**Тригер у цій міграції НЕ створюється.** Це — окрема друга міграція (див. §8).

---

## 8. Apply розбито на дві окремі міграції

**Apply-1 — `audit_infra_shipments`:** усе зі схеми вище (table, indexes, RLS, function). Тригер НЕ створюється. Жодні існуючі UPDATE на shipments не зачіпаються. Безпечно відкатуватись.

**Apply-2 — `audit_enable_trigger_shipments`:**

```sql
DROP TRIGGER IF EXISTS zz_99_log_shipment_changes ON public.shipments;
CREATE TRIGGER zz_99_log_shipment_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.log_shipments_changes();
```

Виконується ОКРЕМО після того як Apply-1 проходить QA. Якщо тригер ламає прод — миттєвий rollback `DROP TRIGGER`, інфраструктура залишається.

---

## 9. Browser PATCH smoke — ДО будь-якої інтеграції wrapper'а у код

Перед заміною прямих `.update()` на wrapper потрібен **окремий ручний smoke** у Build-етапі (один тимчасовий test-only call site):

1. У DevTools з працюючим user-session виконати:
   ```text
   await supabase
     .from('shipments')
     .update({ updated_at: new Date().toISOString() }) // no-op для no-op test
     .eq('id', '<test-shipment-id>')
     .setHeader('x-request-id', 'smoke-' + crypto.randomUUID())
     .setHeader('x-audit-source', 'smoke')
     .setHeader('x-audit-action', 'smoke:patch')
     .setHeader('x-audit-route',  '/__smoke')
     .select('id');
   ```
2. У Network: підтвердити, що PATCH `…/rest/v1/shipments?id=eq.<id>` містить усі 4 заголовки в **одному** запиті.
3. Виконати **реальний** UPDATE (наприклад, `notes`) із тими ж headers.
4. У `psql`: переконатись що `shipment_changes` отримала рядок із `client_request_id='smoke-…'`, `client_source='smoke'`, `request_method='PATCH'`, `request_path` непорожній.
5. Тільки після цього починаємо масову заміну прямих `.update()` на wrapper.

Якщо смок провалюється — інтеграція wrapper не починається. Fallback fall back на варіант "B" (transactional RPC) — окремий план.

---

## 10. Повний інвентар update-точок (runtime, не тільки UI)

`rg -nU "from\(['\"]shipments['\"]\)[\s\S]{0,120}\.update\("` по всьому `src/` + `supabase/functions/` + `src/routes/api/`:

| # | Файл : рядок | Контекст | Поля | UI/Server action | Wrapper застосовний? |
|---|---|---|---|---|---|
| 1 | `src/routes/_authenticated/shipments/$id.products.tsx:1314` | Surgical Recovery commit | `logistics_cost`, `logistics_cost_currency` | `shipments/$id.products:commit-transport` | Так |
| 2 | `src/routes/_authenticated/shipments/$id.products.tsx:1496` | Offer freight auto-fill | `logistics_cost`, `logistics_cost_currency` | `shipments/$id.products:offer-freight-fill` | Так |
| 3 | `src/routes/_authenticated/logistics.tsx:537` | Logistics board row save | динамічний `patch` (driver/vehicle/freight/loading/...) | `logistics:row-save` | Так |
| 4 | `src/routes/_authenticated/distribution/$shipmentId.tsx:244` | Старт розподілу | `status='distributing'` | `distribution:start` | Так |
| 5 | `src/lib/shipments.functions.ts:93` (server fn, **supabaseAdmin**) | `cancelShipment` soft cancel | `status`, `cancelled_by`, `updated_at` | server fn | Так, **server-side wrapper** (див. §11) |
| 6 | `src/lib/shipments.functions.ts:118` (server fn, **supabaseAdmin**) | `cancelShipment` rollback | те саме | server fn | Так, server-side wrapper |

Окремі **INSERT / DELETE** на shipments (для повноти аудиту з §scope):
- INSERT: `src/routes/_authenticated/shipments/new.tsx:994` — створення поставки.
- DELETE: `src/routes/_authenticated/shipments/new.tsx:924` (cleanup при невдачі), `src/lib/cleanup-empty-shipment.ts:197`, `src/lib/shipments.functions.ts:309` (`deleteEmptyDraftShipment`).

Edge functions, що пишуть у shipments: `rg -n "shipments" supabase/functions` — **немає** (поточні edge functions: `admin-users`, `calendar-account-admin`).

Server route hooks: `src/routes/api/public/hooks/shipments-lifecycle.ts` — перевіримо в Build (передбачаю UPDATE по статусах життєвого циклу; буде доданий до wrapper-server варіанта).

**Жодних інших прямих `.update()` на `shipments` у репозиторії не знайдено.**

---

## 11. Wrapper — клієнтський і серверний

### 11.1 `src/lib/shipments-update.ts` (browser)

Сигнатура:

```text
updateShipment({
  id, patch, action, route, returning?
}) → Promise<{ data, error, requestId }>
```

Поведінка (відповідає §12):
1. `const requestId = crypto.randomUUID()`.
2. Виконати `supabase.from('shipments').update(patch).eq('id', id).setHeader(...).select(returning ?? 'id')`.
3. **Тільки після відповіді**:
   - success → `logSystem({ level:'info', action:'shipments.update:success', ... })`;
   - error → `logSystem({ level:'warning', action:'shipments.update:error', ... })`.
4. **Жодного `update_attempt`** перед запитом (зайвий шум, можливі orphan attempts без resolution).

### 11.2 `src/lib/shipments-update.server.ts` (server fn helpers)

Для server fn із `supabaseAdmin`: маленький helper, що проставляє ті самі headers на `supabaseAdmin.from('shipments').update(...).setHeader(...)`. Source — `'server:<fn-name>'`. Кореляція з `system_logs` рядком, що містить `user_id` фактичного caller'а.

---

## 12. Client log — лише `success` / `error`

`system_logs` отримує **рівно один** рядок на ефективну спробу UPDATE:

| Подія | level | message |
|---|---|---|
| Успішний UPDATE | `info` | `shipments.update:success` |
| Помилка UPDATE | `warning` | `shipments.update:error` |

`context` містить тільки: `shipment_id`, `request_id`, `route`, `action`, `payload_keys` (НЕ значення), `affected` (для success), `error_code` + `error_message_short` (для error). Заборонено: повний `patch`, headers, токени, cookies, повне тіло помилки.

**Жодного `update_attempt` рядка.** Якщо UPDATE здох на network — `error` обробник усе одно спрацює; якщо браузер впав — це покриває глобальний `installGlobalErrorLogger`.

---

## 13. Sensitive fields — варіант A (затверджено)

Чутливі колонки (`driver_name`, `driver_phone`, `loading_address`, `loading_reference`, `logistics_comment`, `notes`, `vehicle_plate`, `tractor_plate`, `trailer_plate`) зберігаються в `old_values`/`new_values` **як є**. Доступ — лише `super_admin` через RLS (§7). Жодних редакцій у тригері.

---

## 14. Семантика порядку та nested updates

- `zz_99_log_shipment_changes` бачить `NEW` після всіх BEFORE-тригерів → trigger-derived поля (`pipeline_status`, `logistics_status`, `logistics_cost_usd`, `eur_usd_rate*`) потрапляють у `changed_fields`.
- Вкладений UPDATE із AFTER-тригера в межах тієї ж транзакції створює **окремий audit-row** із тим самим `txid`. Один audit-row != фінальний стан після всіх AFTER. Кореляція в межах транзакції — за `txid`.

---

## 15. Поведінка по джерелах

| Джерело | actor_id | client_source | client_request_id | request_role | Створюється audit-row? |
|---|---|---|---|---|---|
| UI | `auth.uid()` | `'ui'` | UUID із UI | `'authenticated'` | Так |
| `requireSupabaseAuth` server fn | `auth.uid()` | `'server:<name>'` | UUID із server fn | `'authenticated'` | Так |
| `supabaseAdmin` server fn | NULL | `'server:<name>'` | UUID із server fn | `'service_role'` | Так; user_id — у парному `system_logs` |
| Cron / `/api/public/hooks/*` | NULL | `'cron:<endpoint>'` | UUID із route | `'service_role'` | Так |
| psql / SQL editor | NULL | NULL | NULL | NULL | Так (анонімний, видно по NULL) |
| Вкладений UPDATE із AFTER-тригера | той самий | той самий | той самий | той самий | Так, окремий рядок, той самий `txid` |

---

## 16. Кореляція UI ↔ DB і обмеження поточного Build

- **UI кореляція для UPDATE shipments — у scope.** Однозначна пара `system_logs.context.request_id` ↔ `shipment_changes.client_request_id`.
- **UI кореляція для INSERT і DELETE shipments — НЕ в scope** цього Build. Server audit їх запише (op=INSERT/DELETE), але `client_request_id` буде NULL, бо `INSERT` (`shipments/new`) і `DELETE` (`cleanupEmptyShipment`, `deleteEmptyDraftShipment`, `cancelShipment`) не проходитимуть через UI-wrapper із headers. Це фіксуємо явно як обмеження; окреме розширення — наступний tasked Plan.

---

## 17. Retention

Поки нічого не видаляємо. Очікуваний обсяг невеликий (≤ 1 рядок на ефективну зміну). Індекси покривають shipment/request/txid/actor. Опція 12-місячного retention із `DELETE WHERE created_at < now() - interval '12 months'` — окремий, не реалізуємо.

---

## 18. Test plan (виконується після Apply-2, не зараз)

1. **Browser PATCH smoke** (§9) — обов'язковий gate перед інтеграцією wrapper.
2. UI UPDATE одного поля → один audit-row з очікуваним `changed_fields`, `client_request_id` збігається з парним `system_logs`.
3. UI UPDATE із trigger-derived побічними ефектами (`logistics_cost`) → `changed_fields` містить також похідні.
4. No-op UPDATE (тільки `updated_at`) → жодного audit-row.
5. psql UPDATE → audit-row з NULL `actor_id`/`client_*`, не-NULL `txid`.
6. `cancelShipment` (admin) → audit-row UPDATE з `actor_id=NULL`, `client_source='server:cancelShipment'`, парний `system_logs` із реальним `user_id`.
7. INSERT shipment через `/shipments/new` → audit-row op=INSERT, `client_request_id=NULL` (очікувано, §16).
8. DELETE через `deleteEmptyDraftShipment` → audit-row op=DELETE, `client_request_id=NULL`.
9. **Fail-closed test:** штучно зробити `INSERT` у `shipment_changes` неможливим (наприклад, тимчасово `REVOKE` у транзакції) → UPDATE shipments має впасти, а не «тихо» втратити аудит.
10. Nested update перевірка — якщо нічого з AFTER-тригерів не робить vложений UPDATE shipments, фіксуємо це як «cascade чистий».

---

## Що НЕ робимо

- Не змінюємо формули cost/customs/freight/FX.
- Не чіпаємо `position_id`, FIFO, allocations, RLS на `shipments`/`vehicles`/`shipment_items`.
- Не змінюємо UI/layout.
- Не аудитимо `vehicles` (окреме завдання).
- Не реалізуємо retention.
- Не пишемо код у Plan/Preview.

---

## Послідовність наступних кроків (після вашого ОК на цей Preview)

1. **Apply-1** — `audit_infra_shipments` (table + RLS + indexes + function, без тригера). Зупинка.
2. **Browser PATCH smoke** із одного тимчасового call site. Зупинка з результатом.
3. **Apply-2** — `audit_enable_trigger_shipments`. Зупинка.
4. **Build** wrapper'ів + точкова заміна 6 call sites із §10 + парні server-side helpers для `cancelShipment` і lifecycle hook. UI-логіка не змінюється.
5. QA smoke по §18.
6. Звіт.

Кожен крок — окремий запит на ваше схвалення.

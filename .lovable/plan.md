## Проблема
После `Створити та закрити` поставка VITPO-003-ITA-095 не появилась в таблице «Поставки» у Лукача до перезагрузки страницы. Аналитика/Календарь/Філії её видят (их экраны монтируются с нуля и/или используют свои отдельные ключи запросов).

## Корневая причина
- `src/router.tsx`: глобально `refetchOnMount: false`, `refetchOnReconnect: false`, `refetchOnWindowFocus: false`. Это сознательное решение против «мигания» списков.
- В `src/routes/_authenticated/shipments/new.tsx` после успешного создания мы делаем `qc.invalidateQueries(["shipments-list"])`/`["open-vehicles-list"]`, но `/shipments` в этот момент **не смонтирован** → активных observer'ов нет → invalidate только помечает кэш stale, сети не происходит.
- Затем `navigate({to:"/shipments", replace:true})` монтирует список. Из-за `refetchOnMount:false` `useQuery` отдаёт старый кэш без сетевого запроса.
- Realtime-канал `shipments-list-rt` подписывается уже после того, как INSERT/UPDATE прилетели — Realtime не делает replay, события пропадают.
- F5 = полная перезагрузка приложения → query запускается впервые и обращается к серверу.

Факты:
- Таблицы `shipments`, `vehicles`, `shipment_items` есть в `supabase_realtime` (проверено `pg_publication_tables`).
- Запись в БД корректна: `vehicle.status='closed'`, 26 палет, `import_manager_id` Лукача, нет `unloaded_at`/`archived_at`/`cancelled_at`. То есть фильтры списка её пропускают.

## Scope (минимальный, только UI)
Без изменений БД / RLS / RPC / схемы / роутера.

Меняется один файл — `src/routes/_authenticated/shipments/new.tsx`:

1. В `refreshShipmentLists` заменить пары `invalidateQueries` на `refetchQueries` для ключей, которые должны быть свежими сразу после создания:
   - `["shipments-list"]`
   - `["open-vehicles-list"]`
   - `["shipments"]`
   - `["open-vehicles"]`
   - `["logistics-board"]`
   
   `refetchQueries` принудительно ходит в сеть даже для inactive queries и обновляет кэш до того, как пользователь окажется на `/shipments`. После навигации `useQuery` отдаст уже свежие данные, несмотря на `refetchOnMount:false`.

2. Порядок остаётся прежним: `await refreshShipmentLists()` → `resetLocalDraft()` → `navigate(... replace:true)`. Никаких дополнительных хуков, ничего глобального не трогаем.

3. Никаких изменений в `src/routes/_authenticated/shipments/index.tsx`, `src/router.tsx`, в RLS, в orchestrator.

## Что НЕ делаем
- Не трогаем `refetchOnMount` глобально — он защищает все остальные списки от мерцаний (это сознательное решение проекта).
- Не добавляем `router.invalidate()` — он принудительно перезапускает loaders, чего здесь не нужно.
- Не меняем Realtime, не добавляем таблицы в публикацию.

## Acceptance
- Лукач создаёт поставку через `Створити та закрити`. После перенаправления вкладка «Поставки» сразу содержит новую строку **без F5**.
- То же поведение для сценария `Створити` (новая открытая авто-машина в `?tab=vehicles`).
- Поведение «Аналитика / Календарь / Филиалы» не ухудшается.

## Отчёт по завершении
- Changed files: `src/routes/_authenticated/shipments/new.tsx`
- DB touched? no
- RLS touched? no
- Auth touched? no
- Checks: TS, ручной QA Лукачом обоих сценариев.
- Remaining risks: при обрыве сети сразу после Create `refetchQueries` может зафейлиться — UI всё равно перейдёт на `/shipments` (через `try/finally`-семантику Promise.all), а ближайший Realtime-эвент или ручное обновление компенсируют.
- Next safe step: вернуться к `Tropik Archive Live-JWT QA` из `docs/06_NEXT_ACTIONS.md`.
## Цель
Установить персональный набор картинок только для пользователя **Малехів (Львів)** — `id = 44eddfe6-bd13-43ae-acaf-3afb5941179c`, branch `3bb65cb3-27a1-5f18-839a-340271d711fd`. Никакие другие пользователи этих картинок не видят.

## Особое условие по шапке
- **Шапка mobile** = берём `header_desktop.webp/.png` из ZIP (НЕ берём `header_mobile.*` из архива — он намеренно игнорируется).
- **Шапка desktop** = `header_desktop.webp/.png` из ZIP.
- **Splash mobile** = `splash_mobile.webp/.png` из ZIP.
- **Splash desktop** = `splash_desktop.webp/.png` из ZIP.

Никаких изменений в layout/логике header'а — мы просто кладём файл с десктопным контентом под обоими именами (`header_mobile.*` и `header_desktop.*`), и существующий `<picture>` сам подхватит.

## Шаги

1. Создать папку `public/personal-assets/44eddfe6-bd13-43ae-acaf-3afb5941179c/` и положить туда 8 файлов:
   - `header_desktop.webp`, `header_desktop.png` ← из ZIP `header_desktop.webp/.png`
   - `header_mobile.webp`,  `header_mobile.png`  ← **те же самые** desktop-файлы из ZIP (дубликат, по условию пользователя)
   - `splash_desktop.webp`, `splash_desktop.png` ← из ZIP
   - `splash_mobile.webp`,  `splash_mobile.png`  ← из ZIP
   - PSD и `source_*` папки из архива не копируем (исходники, не нужны в проде).

2. Зарегистрировать пакет в `src/lib/branch-assets.ts`:
   ```ts
   const MALEKHIV_USER_ID = "44eddfe6-bd13-43ae-acaf-3afb5941179c";
   const USER_ASSETS: Record<string, PersonalAssets> = {
     [TERESHCHENKO_USER_ID]: buildAssets(TERESHCHENKO_USER_ID),
     [MALEKHIV_USER_ID]:    buildAssets(MALEKHIV_USER_ID),
   };
   ```
   Маппинг идёт по `profile.id` — резолвер уже работает строго per-user, поэтому другие пользователи этих картинок не получат. Branch-level маппинг не добавляю (по требованию «один пользователь — один набор»).

3. Никаких изменений в `AppShell.tsx`, `_authenticated.tsx`, `_authenticated/index.tsx`, `login.tsx` — они уже используют `getPersonalAssets(user.id, profile.branch_id)`.

## Что НЕ трогаю
- POSITION/RLS/formulas/resolver/offers/shipments/logistics/customs/auth/roles.
- Картинки и регистрацию Терещенко.
- Layout/ширину/высоту шапки, шрифты, курс валют, notification bell.
- `src/integrations/supabase/*`, `routeTree.gen.ts`.

## Проверка после имплементации
- `ls public/personal-assets/44eddfe6-.../` — должно быть ровно 8 файлов.
- `header_mobile.webp` и `header_desktop.webp` побайтово одинаковые (sha256 совпадает).
- Войти под Малехів на mobile viewport — шапка десктопная (широкая, тонкая), splash мобильный.
- Войти под Терещенко — его картинки не изменились.
- Войти под любым третьим пользователем — нейтральный fallback, картинок Малехів/Терещенко не видно.
- Typecheck/build.

## Отчёт, который дам после билда
1. Использованные файлы по каждому из 4 слотов (mobile/desktop × header/splash) для Малехів.
2. Подтверждение, что `header_mobile.*` — дубликат `header_desktop.*`.
3. Подтверждение, что mapping лежит в `src/lib/branch-assets.ts` по `user_id`.
4. Подтверждение изоляции: другие пользователи этих картинок не получают.
5. Подтверждение, что бизнес-логика/RLS/формулы/resolver/Терещенко не тронуты.
6. Typecheck/build result.
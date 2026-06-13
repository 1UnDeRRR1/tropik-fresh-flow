
# Plan-only: Evaluation of `etheral-shadow` as new day/night background

Только оценка. Никаких изменений кода, зависимостей, БД, RLS, auth, формул, position_id, словарей, операционных строк.

## 1. Содержимое пакета

`ruixen-etheral-shadow-files.zip` содержит:

- `etheral-shadow-package/src/components/ui/etheral-shadow.tsx` — единственный рабочий файл (~260 строк).
- `etheral-shadow-package/src/examples/etheral-shadow-demo.tsx`, `app-page-example.tsx` — демо.
- `README.md`, `package-dependencies.txt` (одна строка: `npm install framer-motion`).

Компонент использует:
- `framer-motion` (`animate`, `useMotionValue`, `AnimationPlaybackControls`) — для hue-rotate анимации SVG-фильтра.
- Inline SVG `<filter>` с `feTurbulence` + двойным `feDisplacementMap` + `feColorMatrix` + `blur(4px)`.
- `mask-image` / `-webkit-mask-image` поверх цветной заливки.
- Два **удалённых** изображения по умолчанию с `framerusercontent.com` (mask + noise). Можно переопределить через `maskImageUrl` / `noiseImageUrl`.
- Директиву `'use client'` (no-op для нашего стека, не вредит).

## 2. Текущая схема фона приложения

Глобальный фон задан в одном месте — `src/styles.css`:

- строки ~396–410: `body { background-image: url("/page-backgrounds/global/bg_mobile.webp"); ... background-attachment: fixed; }` + `@media (min-width: 768px) { body { background-image: url(".../bg_desktop.webp"); } }`
- строки ~160–165: `html.dark body { background-image: none !important; background-color: var(--color-background); }` — в тёмной теме фото-фон уже отключён, виден только flat surface.

Файлы в `public/page-backgrounds/global/`: `bg_mobile.webp/png`, `bg_desktop.webp/png`.

Дополнительно (НЕ глобальные, трогать не нужно):
- `src/routes/login.tsx` — splash последнего пользователя как backdrop логина.
- `src/routes/_authenticated.tsx` + `src/routes/_authenticated/index.tsx` — splash-overlay при загрузке (personal/owner assets).
- `src/components/AppShell.tsx`, `src/routes/_authenticated/settings.tsx` — персональные header/profile-bg для отдельных пользователей.
- Owner banners в `src/lib/branch-assets.ts`.

Эти слои **поверх** body-фона и завязаны на конкретных пользователей — план их не затрагивает. Заменяется только глобальный body-фон в `styles.css` и файлы в `public/page-backgrounds/global/`.

## 3. Зависимость framer-motion

В `package.json` `framer-motion` **отсутствует**. Установка добавит ~50–60 KB gzip к бандлу. Сам компонент использует только `animate`/`useMotionValue` — это поддерживает tree-shaking, но всё равно дополнительный рантайм. Установка зависимостей — отдельный шаг, в Plan не выполняется.

## 4. Риски анимированной версии

- **CPU/GPU**: `feTurbulence` + двойной `feDisplacementMap` + `blur` под `hueRotate` на 360° бесконечно — один из самых тяжёлых паттернов в SVG. На фоне `body` это перерисовывается под каждым скроллом/перерисовкой страницы. На слабых Android / старых iPad возможны заметные просадки FPS и тротлинг батареи.
- **Safari / iOS**: `mask-image` + `feDisplacementMap` исторически работают, но `filter: url(#...)` на больших областях даёт фризы и баги отрисовки в iOS Safari.
- **Удалённые ассеты**: `framerusercontent.com` — внешний CDN Framer, без SLA для нас. Любой сбой = пропадает mask и фон становится сплошным цветом. Это нарушает `STOP` условие «требует ненадёжных внешних ассетов».
- **Noise overlay**: `opacity` до 1.0 заметно снижает читаемость текста в гуттерах вокруг карточек.
- **Reduced motion**: компонент не уважает `prefers-reduced-motion`.
- **Тяжёлые экраны** (`manager-offers`, `branch-offers`, архив, distribution) — там и так много DOM/таблиц; дополнительный постоянный фильтр на body может усугубить лаг при скролле.

## 5. Совместимость с существующей архитектурой

- Body имеет `background-attachment: fixed` — текущий подход дешёвый (один растровый слой). Замена на компонент потребует фиксированного слоя `<div className="fixed inset-0 -z-10">` где-то в `__root.tsx` или `_authenticated.tsx`. Это **редизайн слоёв layout**, выходит за рамки «точечной замены».
- Splash overlay (`z-50`) и owner/personal backgrounds останутся выше — конфликта по z-index нет, но нужно убедиться, что новый слой строго `-z-10`/`z-0` и `pointer-events-none`, иначе перехватит клики на пустых экранах.
- Dark mode уже гасит body-image. Нужно либо: (a) расширить ту же логику на новый компонент (рендерить только в light), либо (b) сделать вторую конфигурацию для dark.

## 6. Рекомендация

**B — Static-first.** Анимированная версия как глобальный body-фон даёт нетривиальный риск производительности и зависит от внешнего Framer CDN. Установка `framer-motion` ради глобального фонового эффекта — диспропорционально.

Минимум, что нужно сделать до любого Build:
1. Залить локально mask-изображение (и при желании noise) в `public/page-backgrounds/global/` — никаких ссылок на `framerusercontent.com`.
2. Сгенерировать **один статичный кадр** желаемого вида (либо средствами компонента в браузере с `animation.scale=0`, либо просто экспорт PNG/WebP под мобайл/десктоп) — это и есть продакшен-фон. По сути возвращаемся к той же модели, что сейчас (две картинки day/night), только с новой эстетикой.

Анимированный компонент можно держать как опцию для одного экрана (например, login backdrop) позже, отдельной задачей — но **не** как глобальный body-фон.

## 7. Day/Night конфигурация (для static-first)

- Day: `public/page-backgrounds/global/bg_mobile.webp` + `bg_desktop.webp` — заменить файлы новыми статичными кадрами (светлая палитра, низкая насыщенность шумa).
- Night: либо оставить текущее поведение (`html.dark body { background-image: none }` = flat dark surface), либо завести параллельный набор `bg_mobile_dark.webp`/`bg_desktop_dark.webp` и подключить через `html.dark body { background-image: url(...dark.webp); }`.
- Переключение темы — через уже существующий `ThemeProvider`; флика нет, потому что меняется только CSS-правило `html.dark body`.

## 8. Читаемость

Карточки/таблицы/диалоги в проекте используют `--card`/`--popover` (непрозрачные), поэтому фон виден только в гуттерах. Тем не менее у нового статичного фона надо проверить контраст бордюров `--border` (`oklch(0.92 0.008 250)`) и текста на пустых экранах (`Settings`, splash, login). Если фон визуально шумный — добавить `body::before` полупрозрачный wash (например, `bg-background/40`) глобально, без правок компонентов.

## 9. План тестирования (до Build)

После принятия static-варианта прогнать вручную в preview:
- main dashboards (manager, branch, owner), `manager-offers`, `branch-offers`, archive, distribution, login, splash.
- mobile 390×844 и desktop 1440+.
- light/dark переключение из Settings.
- скролл больших таблиц (FPS на глаз).
- проверка, что splash и personal/owner assets не перекрыты и не перекрывают новый фон.

## 10. Предлагаемый узкий Build scope (если позже одобрите вариант B)

Затрагиваемые файлы — **только**:
- `public/page-backgrounds/global/bg_mobile.{webp,png}` — заменить файлами.
- `public/page-backgrounds/global/bg_desktop.{webp,png}` — заменить файлами.
- (опционально) `public/page-backgrounds/global/bg_mobile_dark.webp`, `bg_desktop_dark.webp` — новые.
- `src/styles.css`: при необходимости добавить правило `html.dark body { background-image: url(...dark.webp); }` вместо текущего `none`. Иначе CSS не меняется (URL остаётся прежним).

Никаких новых зависимостей. Никаких новых React-компонентов. `framer-motion` **не ставится**. Никаких правок `AppShell`, `__root.tsx`, `_authenticated.tsx`, splash, personal/owner assets, login.

## 11. STOP-флаги, которые сейчас сработали против анимированной версии

- Требует внешних ассетов (`framerusercontent.com`) — нестабильность.
- Нетривиальный риск лага на мобиле без статичного fallback из коробки.
- Чтобы стать глобальным фоном корректно — нужно вмешательство в layout-слой (`__root`/`_authenticated`), это редизайн AppShell-окружения.
- Требует добавления `framer-motion` ради декоративного эффекта.

## 12. Risk confirmations

- DB touched? no
- RLS touched? no
- Auth touched? no
- RPC/functions/triggers/migrations touched? no
- Roles / role visibility touched? no
- Branch/logistics/broker visibility touched? no
- Cost/customs/transport/FX formulas touched? no
- Net/gross/pallet formulas touched? no
- position_id lifecycle touched? no
- Reference dictionaries touched? no
- Old operational rows touched? no
- UI/code touched? no
- Dependency installed? no

## Итоговая рекомендация

**B — Static-first.** Не устанавливать `framer-motion`, не подключать компонент `EtheralShadow` как глобальный body-фон. Если эстетика etheral-shadow желательна — сгенерировать статичные кадры (light + опционально dark), положить в `public/page-backgrounds/global/`, заменить текущие файлы. Анимированный вариант — отдельной поздней задачей и максимум на одном экране (например, login), не глобально.

# AUDIT — 6.7 COFFEE: полное текущее состояние проекта

**Дата аудита:** 2026-10-25
**Ветка:** `main` (оба репозитория), HEAD основного репозитория — `7e67a23`
**Режим:** только чтение исходников, тестов и конфигураций. Единственное изменение в репозитории — этот файл.

## Как читать отчёт

| Пометка | Значение |
|---|---|
| **[Ф]** | Подтверждённый факт: проверено в исходниках/тестах/запуске, указан файл и строка |
| **[В]** | Вывод по коду: следствие из прочитанного кода, в рантайме не наблюдалось |
| **[П]** | Предположение: требует проверки на устройстве, внешнем сервисе или production |

Статусы задач: `DONE` · `PARTIAL` · `MISSING` · `BROKEN` · `UNVERIFIED` · `CONFLICT`.
Приоритеты: `P0` (безопасность/потеря данных/невозможность основных операций) · `P1` (блокирует основной бизнес-процесс) · `P2` (важный пробел) · `P3` (улучшение/некритичный дефект).

**Границы аудита (важно):** интеграция с Evotor Cloud не проверялась «вживую» — в окружении аудита нет токена `EVOTOR_API_TOKEN` (админка показывает `Error: EVOTOR_API_TOKEN not set`, проверено на превью `http://admin.localhost:3970`). Android-приложение не собиралось и не запускалось на терминале. Поэтому всё, что зависит от облака Эвотор и устройства, помечено `UNVERIFIED`, а не «работает».

---

## Оглавление

1. [Краткое резюме состояния](#1-краткое-резюме-состояния)
2. [Карта репозиториев и архитектуры](#2-карта-репозиториев-и-архитектуры)
3. [Frontend: разделы и готовность](#3-frontend-разделы-и-готовность)
   - [3.1 Админка: маршруты и карточки разделов](#31-админка-маршруты-и-карточки-разделов)
   - [3.2 Адаптивность админки](#32-адаптивность-админки)
   - [3.3 PWA](#33-pwa)
   - [3.4 Касса (Android, отдельный репозиторий)](#34-касса-android-отдельный-репозиторий)
4. [Реестр API](#4-реестр-api)
   - [4.1 Полный реестр по модулям](#41-полный-реестр-по-модулям)
   - [4.2 Контракты ключевых методов](#42-контракты-ключевых-методов)
   - [4.3 Аномалии реестра](#43-аномалии-реестра)
5. [База данных и бизнес-логика](#5-база-данных-и-бизнес-логика)
6. [Аудит бизнес-процессов](#6-аудит-бизнес-процессов)
7. [Интеграции и устройства](#7-интеграции-и-устройства)
8. [Тесты, сборки, качество](#8-тесты-сборки-качество)
9. [Полный список незавершённых задач](#9-полный-список-незавершённых-задач)
10. [Приоритетный план следующих работ](#10-приоритетный-план-следующих-работ)
11. [Ограничения аудита](#11-ограничения-аудита)
12. [Git status и подтверждение неизменности](#12-git-status-и-подтверждение-неизменности)

---

## 1. Краткое резюме состояния

**Продукт.** 6.7 Coffee — программа лояльности + операционная админка для сети кофеен на кассах Эвотор. Состоит из двух репозиториев: `demossml/sixth-cup` (backend + PWA + React-админка, npm-workspaces + Turborepo) и `demossml/evotor-app` (Android-приложение кассира, Kotlin).

**Что подтверждено (не зависит от внешних сервисов).** Backend — единый Hono-сервис, 223 объявленных маршрута в 24 файлах, SQLite через `better-sqlite3`, 29 SQL-миграций. Тесты: backend **205/205** (36 файлов), админка **18/18** (4 файла), PWA **52/52** (4 файла). `npm run typecheck` — 3/3 пакета без ошибок. `turbo run build --force` — 3/3. Админка: 18 маршрутов, все обращения админки к API имеют обработчик на бэкенде (проверено скриптом сопоставления, 76 клиентских путей → 0 «висячих»). PWA типизирована через `hc<AppType>` — расхождение путей с бэкендом структурно невозможно.

**Что нельзя считать готовым.**
- Всё, что требует облака Эвотор (создание/обновление товаров в облаке, выгрузка каталога, poll чеков, начисления) — код есть, тесты на фикстурах есть, **реальный обмен не проверен** (нет токена в окружении аудита).
- Всё, что требует терминала (стабильность `article_number → ProductTable.ROW_CODE`, порядок/скрытие групп меню на экране кассы, ProductExtra с рецептом и добавками, фискальный SELL → poll → начисление) — **не проверено на устройстве**.
- Web Push, редактирование поставщиков, UI регистрации кассового устройства, часть backend-endpoints без клиента — фактические пробелы (см. §9).

**Самые существенные риски.** (1) Отсутствие проверки цепочки «каталог → облако → терминал → чек → начисление» на реальном оборудовании — при этом именно она является ядром продукта. (2) `EVOTOR_PROXY_ENFORCE` по умолчанию выключен: при пустом `EVOTOR_PROXY_TOKEN` эндпоинты `/api/devices/*` (табель, перерывы, смена) отвечают без авторизации. (3) Схема БД собирается из трёх источников (`SCHEMA` в `db/schema.ts`, `CREATE TABLE IF NOT EXISTS` внутри 6 модулей и 29 миграций) — риск дрейфа схемы между окружениями.

---

## 2. Карта репозиториев и архитектуры

### 2.1 Репозитории

| Репозиторий | Путь | Назначение | Стек | Точка входа |
|---|---|---|---|---|
| `demossml/sixth-cup` | `/Users/dmitrijsuvalov/Downloads/sixth-cup` | Backend API + PWA гостя + React-админка (монорепо, workspaces `backend`, `frontend`, `frontend-admin`) | Node + TypeScript, Hono, better-sqlite3, React 18 + Vite + Tailwind, Phaser 3 (игра) | `backend/src/index.ts` → `backend/src/app.ts`; `frontend/src/main.tsx`; `frontend-admin/src/main.tsx` **[Ф]** |
| `demossml/evotor-app` | `/Users/dmitrijsuvalov/Documents/evotor-app` | Android-приложение кассира на терминале Эвотор (каталог, добавки, лояльность, очередь, смена) | Kotlin, Gradle, `com.github.evotor:integration-library:v0.6.27`, `compileSdk 34`, `minSdk 23`, `targetSdk 30` | `app/src/main/java/ru/sixthcup/evotor/SixthCupApp.kt`, `ui/MainActivity.kt` **[Ф]** |

Источник истины по данным (заявлено и подтверждено кодом):
- Evotor Cloud — торговые точки, сотрудники, базовая номенклатура, Evotor UUID **[Ф]** (`README.md:7-11`, `backend/src/modules/admin/evotorCatalog.ts`);
- 6.7 backend — рецепты, топпинги/добавки, лояльность, себестоимость, метаданные **[Ф]** (`docs/CATALOG-VARIANTS-ADDONS.md`, `backend/src/modules/catalog/addonScheme.ts`);
- 6.7 admin — единый интерфейс к обоим источникам **[Ф]**;
- APK — только отображение локального каталога кассы поверх `integration-library` **[Ф]**.

### 2.2 Связи компонентов

```
                        ┌──────────────────────────────┐
   гость (PWA)  ───────►│  backend (Hono, один процесс)│◄────── admin SPA (X-Admin-Token)
   /api/auth, /api/sync │  SQLite (better-sqlite3)     │        /api/admin/*
   /api/directory       │  uploads/ (фото, видео)      │
   /api/loyalty, /game  └───────┬──────────────┬───────┘
                                │              │
                    Evotor Cloud API      Evotor Cloud Proxy
                    (api.evotor.ru,       (Authorization из кабинета,
                     X-Authorization)      без секретов в APK)
                                │              │
                                │        ┌─────▼─────────────┐
                                │        │ APK на терминале  │
                                │        │ /api/devices/*    │
                                └───────►│ (catalog, resolve,│
                                         │  shift, timesheet)│
                                         └───────────────────┘
```

Подтверждения: маршрутизация по `Host` (admin.* → `frontend-admin/dist`, иначе → `frontend/dist`) — `backend/src/app.ts:163-215` **[Ф]**; проксирование облака — `backend/src/middleware/evotorProxy.ts`, `backend/src/integrations/evotor/client/EvotorClient.ts` **[Ф]**; APK ходит только через прокси и не содержит секрета — `app/src/main/java/ru/sixthcup/evotor/net/LoyaltyApi.kt:12-17` **[Ф]**.

### 2.3 Команды (подтверждены файлами проектов)

| Действие | Команда | Источник |
|---|---|---|
| Dev-серверы (PWA :5173, admin :5174, API :3000) | `npm run dev` | `package.json` (root), `README.md:33-38` |
| Сборка всего | `npm run build` (`turbo run build`) | `package.json`, `turbo.json` |
| Typecheck | `npm run typecheck` (`turbo run typecheck`) | `package.json` |
| Тесты backend | `npx vitest run` в `backend/` | `backend/package.json`, `backend/vitest.config.ts` |
| Тесты админки | `npx vitest run` в `frontend-admin/` | `frontend-admin/package.json` |
| Тесты PWA | `npx vitest run` в `frontend/` | `frontend/package.json` |
| Прод | `npm start` (`-w backend`) | `package.json` |
| APK | `./gradlew assembleRelease` / `testDebugUnitTest` | `evotor-app/app/build.gradle.kts` **[Ф, не запускалось в аудите]** |

---

## 3. Frontend: разделы и готовность

### 3.1 Админка: маршруты и карточки разделов

**Точки входа и каркас.** `frontend-admin/index.html` (единственный vite-input `main`) → `src/main.tsx` → `HashRouter` → `src/App.tsx` (ленивые страницы, `Suspense`). Авторизация: токен в `tokenStore` (`src/api/client.ts`), проверка через `GET /api/admin/meta`; при 401 — `setUnauthorizedHandler` разлогинивает **[Ф]** (`App.tsx:60-90`).
Каркас: `src/layout/Shell.tsx` — боковое меню (группы «Смена / Управление / Аналитика» + «Справка / Система»), верхняя панель с поиском (`#/operations?q=…`), мобильная нижняя навигация и лист «Все разделы» (появились в `7e67a23`) **[Ф]**.

| # | Раздел | Маршрут | Файл | Тест | Статус |
|---|---|---|---|---|---|
| 1 | Сегодня | `/` | `pages/Today.tsx` | — | DONE |
| 2 | Операции | `/operations` (+ `?q`, `?view`, `?store`, `?period`, `?open`) | `pages/Operations.tsx` | — | DONE |
| 3 | Клиенты | `/customers` | `pages/Customers.tsx` | — | DONE |
| 4 | Карта клиента | `/customers/:id` | `pages/CustomerCard.tsx` | — | DONE |
| 5 | Меню (4 вкладки) | `/menu`, `?section=products\|groups\|modifiers\|schemes` | `pages/Menu.tsx`, `MenuProducts.tsx`, `MenuGroups.tsx` | `lib/addonScheme.test.ts` | DONE/PARTIAL (см. 3.1.5) |
| 6 | Касса | `/cash` | `pages/Cash.tsx`, `pages/cash/CashierMenuPanel.tsx` | `cashier-menu.test.ts`, `CashierMenuPanel.test.ts` | DONE, интеграция UNVERIFIED |
| 7 | Контент (маркетинг) | `/marketing`, `?tab=content\|vouchers` | `pages/Marketing.tsx`, `marketing/PromoMediaField.tsx` | `mediaUrl.test.ts`, `promo-title-optional.test.ts`, `content-availability.test.ts` | DONE |
| 8 | Рефералка | `/referrals` | `pages/Referrals.tsx` | `referral.test.ts` | DONE |
| 9 | Аналитика | `/analytics` | `pages/Analytics.tsx` | `analytics-series.test.ts` | DONE |
| 10 | Сравнение | `/compare` | `pages/Compare.tsx` | — | DONE |
| 11 | События | `/events` | `pages/BusinessEvents.tsx` | — | DONE |
| 12 | Помощник (ИИ) | `/assistant` | `pages/Assistant.tsx` | `studio.test.ts:114` | UNVERIFIED (нет `AI_API_KEY`) |
| 13 | Система | `/system`, `?tab=logs\|audit\|ai` | `pages/System.tsx` | `logs.test.ts` | DONE |
| 14 | Сотрудники | `/staff` | `pages/Staff.tsx` | — | PARTIAL (нет тестов) |
| 15 | Склад (6 вкладок) | `/stock` | `pages/Stock.tsx`, `stock/RecipesTab.tsx` | `studio.test.ts:86` | DONE |
| 16 | Закупки (7 вкладок) | `/purchases`, `?tab=invoices\|orders\|returns\|suppliers\|debt\|bank\|recon` | `pages/Purchases.tsx`, `purchases/*.tsx` | `studio.test.ts:27,51`, `BankTab.test.ts` | DONE/PARTIAL (редактирование поставщика — нет UI) |
| 17 | Инвентаризация | `/inventory` | `pages/Inventory.tsx` | `studio.test.ts:106` | DONE |
| 18 | Справка | `/help`, `?a=…` | `pages/Help.tsx` | — | DONE (контент в коде) |

Маршруты зарегистрированы в `frontend-admin/src/App.tsx:81-101`; `*` → редирект на `/` **[Ф]**.

#### 3.1.1 Сегодня — `/`

- Файл: `pages/Today.tsx`; KPI-плитки, два графика, «Требует внимания», таблица касс, «Последние операции».
- Данные: `GET /api/admin/dashboard?period&store` (`console.ts:164`), `GET /api/admin/analytics/series` (`analytics.ts:48`), `GET /api/admin/catalog/quality` (`routes.ts:1059`), `POST /api/admin/evotor/poll` (`evotorCatalog.ts:299`).
- Состояния: `useApi` отдаёт `loading/error/reload`; ошибка Эвотор показывается баннером, а не пустым экраном **[Ф]** (проверено в браузере на превью: «Эвотор недоступен — список точек показан из кэша»).
- Требование: «что происходит на кассе и с начислением чашек» (`GUIDE.md`, раздел dashboard) — покрыто.
- Риск: показатели зависят от данных poll; при пустой БД — честные нули **[Ф]**.

#### 3.1.2 Операции — `/operations`

- Файл: `pages/Operations.tsx`; вкладки Все/Начислено/Без карты/Ошибки/Споры; курсорная пагинация, CSV.
- API: `GET /api/admin/operations` (`console.ts:285`), `GET /api/admin/operations.csv` (`console.ts:267`), `GET /api/admin/operations/:store/:doc` (`console.ts:290`), `GET /api/admin/disputes` (`routes.ts:1277`).
- Фильтры живут в адресе (`?q=&view=&store=&period=`) через `lib/query.ts` — ссылку можно переслать **[Ф]**.
- CSV: BOM + защита от формул-инъекций (`admin-console.test.ts:43`) **[Ф]**.

#### 3.1.3 Клиенты и карта клиента

- `pages/Customers.tsx`: `GET /api/admin/customers?q&sort&dir&limit&offset` (`console.ts:302`).
- `pages/CustomerCard.tsx`: `GET /api/admin/customers/:id` (`:327`), `GET /customers/:id/phone` (`:375`, раскрытие телефона — отдельным действием), `POST /customers/:id/vouchers` (`:404`), `GET /voucher-templates` (`:393`), переход в операцию `#/operations?open=<store>/<doc>`.
- Модель «гость = карта»: телефон не обязателен; ручной номер карты нормализуется (`modules/loyalty/proof.ts:11-19`, тест `card-code.test.ts:5-24`) **[Ф]**.

#### 3.1.4 Меню — `/menu`

- `MenuProducts.tsx`: `GET/POST /api/admin/products`, `GET /categories`, `GET /product-groups`, `GET /modifier-schemes`, `POST /products/bulk`, `GET /stock/norms`, `GET /stock/items?active=1`; загрузка фото через `uploadFile` → `POST /api/admin/upload`.
- `MenuGroups.tsx`: `GET/POST /categories`, `GET/POST/DELETE /product-groups`, `GET/POST/DELETE /modifiers`, `GET/POST/DELETE /modifier-schemes`, `GET /addon-groups`.
- Варианты товара и добавки: `docs/CATALOG-VARIANTS-ADDONS.md`; backend `modules/catalog/addonScheme.ts` (820 строк), `productIdentity.ts`.
- Тесты: `addon-*.test.ts` (10 файлов), `product-variants.test.ts` (8 тестов).
- **Пробел:** переключатель «Считать чашкой»/«Бесплатно по лояльности» и нормы списания — в карточке товара; отдельных экранов нет, это соответствует ТЗ **[В]**.

#### 3.1.5 Касса — `/cash`

- Файлы: `pages/Cash.tsx`, `pages/cash/CashierMenuPanel.tsx`.
- API: `GET /api/admin/evotor/stores` (`evotorCatalog.ts:90`), `PATCH /evotor/stores/:uuid` (sync on/off, `:142`), `POST /evotor/stores/:uuid/sync` (`:231`), `POST /evotor/stores/:uuid/push-products` (`:247`), `GET /evotor/stores/:uuid/products` (`:257`), `GET .../products/drift` (`:277`), `POST .../wipe-catalog` (`:287`), `POST /evotor/poll` (`:299`), `GET /evotor/health` (`console.ts:161`), `GET/POST/DELETE /evotor/tokens` (`evotorTokens.ts`), `GET /evotor/employees` (`evotorCatalog.ts:155`), `GET/PATCH/DELETE /api/admin/cashier/menu` (`routes.ts:400,423,448`).
- Меню кассы: общая (наследство) и per-store настройки, порядок групп + скрытие + «Всё» (`lib/cashierMenu.ts`); тесты `cashier-menu.test.ts` (9) и `CashierMenuPanel.test.ts` (4) **[Ф]**.
- Риск: фактическое влияние на экран кассы (`menu.order/hidden/showAllTab`) проверяется только APK (см. §7) → `UNVERIFIED`.

#### 3.1.6 Контент (маркетинг) — `/marketing`

- Вкладки «Контент PWA» / «Ваучеры»; CRUD промо: `GET/POST /promos`, `PATCH /promos/:id`, `POST /promos/:id/publish|unpublish`, `DELETE /promos/:id` (`routes.ts:1124-1266`), массовая выдача — `POST /vouchers/grant-all` и `GET /vouchers/grant-all/preview`.
- Медиа: `PromoMediaField.tsx` — загрузка файла, отклонение локальных путей (`file://`, `C:\…`, `/Users/…`) с понятным текстом (`mediaUrl.test.ts`), лимиты 2 МБ фото / 20 МБ видео, сигнатура контейнера на сервере (`upload/routes.ts:59-113`).
- Тесты: `promo-title-optional.test.ts` (7) — заголовок необязателен; `content-availability.test.ts` (2) — публикация по окну дат.
- Косметический дефект: в карточке контента бейдж «B PWA» переносится на две строки на узком экране (`.content-top .pill` без `nowrap`), см. `AUDIT-FE-001`.

#### 3.1.7 Сотрудники — `/staff`

- API: `GET/POST /staff`, `DELETE /staff/:id`, `PUT /staff/:id/device` (`staff/adminRoutes.ts:8-62`), `GET/PUT /staff/schedule`, `GET/POST /staff/wish-rules`, `GET /staff/wishes`, `PUT /staff/wishes/:id`.
- Данные для кассы: `GET /api/devices/shift/*`, `/timesheet` (`staff/deviceRoutes.ts`) — используются APK.
- **Пробел:** тестов на `staff/adminRoutes.ts` нет (grep по `api/admin/staff` в `backend/src/__tests__` — 0 совпадений) → `AUDIT-TEST-001`.

#### 3.1.8 Склад — `/stock`

- Вкладки: Остатки, Сроки, Номенклатура, Нормы, Рецептуры, Без нормы.
- API: `GET /stock/items|balances|expiry|norms|products-without-norms`, `POST /stock/items`, `DELETE /stock/norms/:id`, `GET/PUT /stock/recipes` (`studio.ts:647`), `GET /stock/consumption` (`:695`), `GET /stock/snapshot` (`:714`).
- Запись остатков — только через проведённые документы (`stock.ts:2-3`) **[Ф]**.

#### 3.1.9 Закупки — `/purchases`

- Вкладки: Накладные, Заказы, Возвраты, Поставщики, Долги, Банк, Сверки. Вкладка — в адресе (`?tab=`), по образцу `Menu.tsx` (`Purchases.tsx:38-45`) **[Ф]**.
- API: `GET /purchases/invoices|debt|orders|order-helper|returns|reconciliations|bank-rows|snapshot|payments`, `POST /purchases/invoices/:id/post|receive`, `POST /purchases/orders/:id/to-invoice`, `POST /purchases/returns/:id/post`.
- Цепочка «заказ → накладная → проведение → приход на склад → долг поставщику» проверена тестом `studio.test.ts:27` **[Ф]**.
- **Пробел:** поставщик создаётся, но не редактируется и не удаляется из UI (`PATCH/DELETE /suppliers/:id` есть на бэкенде, клиента нет) → `AUDIT-PUR-001`.

#### 3.1.10 Инвентаризация — `/inventory`

- API: `POST /inventory` (создать), `GET /inventory`, `GET /inventory/overview`, `GET /inventory/:id/sheet`, `PATCH /inventory/:id/lines`, `POST /inventory/:id/recount|submit|post|cancel`.
- `studio.test.ts:106` — отдельный тест на то, что `/inventory/overview` не перехватывается `/inventory/:id` **[Ф]**.

#### 3.1.11 Система / Справка / Помощник

- Система: `GET /logs`, `POST /logs/test`, `GET /stats`, `POST /reset` (в production по умолчанию запрещён — `config.adminAllowReset`, баннер «Сброс данных отключён»), `GET/PUT /ai/settings`.
- Справка: статический контент в `pages/Help.tsx` (+ `?a=` на статью), API не использует.
- Помощник: `GET /ai/feed` (лента подсказок), `POST /ai/ask|catalog-advice|content-draft|anomaly-explain|shift-summary`. Без `AI_API_KEY` — честная ошибка 503 (`studio.test.ts:114`) → `UNVERIFIED`.

### 3.2 Адаптивность админки

Реализовано в коммите `7e67a23` («feat(admin): make the existing admin usable on phones»), файлы: `layout/Shell.tsx`, `styles/coffee.css`, `ui/kit.tsx`, `pages/Purchases.tsx` **[Ф]**.

- Нижняя панель `≤760px`: Сегодня `/`, Касса `/cash`, Заказы `/purchases?tab=orders`, «И ещё»; активный пункт помечен полоской + жирным + `aria-current` (не только цветом).
- «И ещё» — лист со всеми разделами десктопного меню (15 пунктов, исходные группы), закрывается кликом по фону/Escape, содержит «Выйти».
- Отступ контента под панель с `env(safe-area-inset-bottom)`; поиск в шапке больше не выходит за экран; `Drawer`/`ConfirmDialog` ограничены `dvh` и скроллятся внутри; широкие таблицы прокручиваются внутри карточки.
- Проверка: 119 комбинаций (17 маршрутов × 320/360/390/430/768/1024/1440 px) — переполнения страницы нет ни на одном; панель видна ровно `≤760px`; на 1440 раскладка не изменилась (сайдбар 244 px, поиск 300 px) **[Ф, Chromium через Playwright]**.
- Ограничение: реальный iOS/Android не проверялся → `UNVERIFIED` для `env(safe-area-inset-*)` и поведения экранной клавиатуры.

### 3.3 PWA

Маршруты (`frontend/src/App.tsx:130-157`) **[Ф]**:

| Маршрут | Файл | Назначение | API |
|---|---|---|---|
| `/onboarding` | `pages/OnboardingPage.tsx` | первый запуск, выпуск карты | `POST /api/auth/guest` |
| `/` | `pages/CardPage.tsx` | карта, QR, прогресс до бесплатного | `GET /api/loyalty/card` |
| `/card-qr` | `pages/CardQrPage.tsx` | полноэкранный QR | `GET /api/loyalty/card` |
| `/menu` | `pages/MenuPage.tsx` | меню, добавки, поиск | `GET /api/directory` |
| `/promos` | `pages/PromosPage.tsx` | акции/баннеры | `GET /api/directory` (content) |
| `/me` | `pages/ProfilePage.tsx` | профиль, восстановление | `POST /api/auth/recovery` |
| `/invite` | `pages/InvitePage.tsx` | приглашения | `GET /api/loyalty/card` (friends) |
| `/more` | `pages/MorePage.tsx` | навигация, игра | — |
| `/history` | `pages/HistoryPage.tsx` | история начислений | `GET /api/sync/history` |
| `/stores` | `pages/StoresPage.tsx` | точки | `GET /api/directory` |
| `/game` | `pages/GamePage.tsx` | игра Alpaca | `/api/game/*` |
| `/legal`, `/about` | `LegalPage.tsx`, `AboutPage.tsx` | документы | `GET /api/public/content` |

Клиент: `hc<AppType>` (`frontend/src/api.ts:13`) + точечные `fetch` (`/api/game*`, `/api/sync/history`, `/api/public/content`, `/api/client-logs`, `/api/analytics/events`). Оффлайн: очередь чеков (`lib/customer.ts`), очередь наград игры (`lib/gameQueue.ts` — «Rewards apply only after successful server claim»), IndexedDB (`lib/db.ts`) **[Ф]**.

Замечание: `DEPLOYMENT.md` упоминает экран PWA `/cashier`, которого в роутере нет → `AUDIT-DOC-001` (CONFLICT, документация).

### 3.4 Касса (Android, отдельный репозиторий)

- Экраны: `CARD`, `ORDER`, `SHIFT`, `QUEUE` (`MainActivity.kt:157`); подэкраны смены: `timesheet`, `wishes`, `team`, `ops`, `stats`, `breaks`, `close` — все имеют реальные рендереры (`renderShiftTimesheet/Wishes/Team/Ops/Stats/Breaks/Close`, `MainActivity.kt:3442-3877`), `renderShiftStub` остаётся только недостижимым fallback (`:3314`) **[Ф]**. Это снимает устаревшее утверждение `CODE-AUDIT-2026-10.md:193` о «заглушках ops/…».
- Сеть: `/api/devices/catalog`, `/api/devices/loyalty/resolve`, `/api/devices/whoami`, `/api/devices/shift/summary|team|breaks`, `/api/devices/breaks/recommendation`, `/api/devices/timesheet`, `/api/devices/timesheet/wishes` (`net/CatalogApi.kt`, `LoyaltyApi.kt`, `ShiftApi.kt`) **[Ф]**.
- Ручной ввод номера карты: числовое поле «Номер карты или QR» + кнопка поиска, повтор последней карты (`MainActivity.kt:550-575`) **[Ф]**.
- Меню: `data/MenuTabs.kt:32-33` фильтрует группы из `menu.hidden` и учитывает `menu.order` **[Ф]**; тесты `MenuTabsTest.kt`.
- Локальная логика с тестами: `DiscountCalc`, `FoodRules`, `FreeCupRules`, `Prices`, `ToppingRules`, `DrinkVariants`, `OrderQueue`, `CatalogCache`, `ReceiptValidator` — 18 тестовых файлов в `app/src/test` **[Ф]**, запуск в аудите не выполнялся.

---

## 4. Реестр API

### 4.1 Полный реестр по модулям

**Как получен.** Автоматическое извлечение всех объявлений `.get/.post/.patch/.put/.delete('<путь>'` из `backend/src/**/*.ts` (исключая `__tests__`), с вычислением полного пути по точке монтирования в `backend/src/app.ts:145-158`. Итог: **223 маршрута в 24 файлах** (GET 108, POST 72, PATCH 17, DELETE 18, PUT 8). Назначение каждого метода — **[В]** по коду обработчика и модулю; сам факт существования маршрута, файл и строка — **[Ф]**. Клиенты указаны в §4.2 и §4.3.

Точки монтирования: `/api/auth`, `/api/loyalty`, `/api/directory`, `/api/sync`, `/api/devices` (два роутера — общий и staff), `/api/dev/`, `/api/client-logs`, `/api/admin` (девять вложенных роутеров), `/api/admin/upload`, `/api/game`, `/api/game/runner`, `/api/public`, `/api/analytics` **[Ф]**.


**`app.ts`**

| Метод | Полный путь | Обработчик | Авторизация |
|---|---|---|---|
| GET | `/health` | `backend/src/app.ts:92` | — |
| GET | `/uploads/:file` | `backend/src/app.ts:94` | — |

**`admin/ai.ts`**

| Метод | Полный путь | Обработчик | Авторизация |
|---|---|---|---|
| GET | `/api/admin/ai/settings` | `backend/src/modules/admin/ai.ts:66` | X-Admin-Token (owner/manager/viewer) |
| PUT | `/api/admin/ai/settings` | `backend/src/modules/admin/ai.ts:69` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/ai/catalog-advice` | `backend/src/modules/admin/ai.ts:96` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/ai/content-draft` | `backend/src/modules/admin/ai.ts:121` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/ai/ask` | `backend/src/modules/admin/ai.ts:145` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/ai/anomaly-explain` | `backend/src/modules/admin/ai.ts:164` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/ai/shift-summary` | `backend/src/modules/admin/ai.ts:197` | X-Admin-Token (owner/manager/viewer) |

**`admin/analytics.ts`**

| Метод | Полный путь | Обработчик | Авторизация |
|---|---|---|---|
| GET | `/api/admin/analytics/series` | `backend/src/modules/admin/analytics.ts:48` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/analytics/by-store` | `backend/src/modules/admin/analytics.ts:160` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/referrals/summary` | `backend/src/modules/admin/analytics.ts:224` | X-Admin-Token (owner/manager/viewer) |

**`admin/assignments.ts`**

| Метод | Полный путь | Обработчик | Авторизация |
|---|---|---|---|
| GET | `/api/admin/overview` | `backend/src/modules/admin/assignments.ts:36` | X-Admin-Token (owner/manager/viewer) |
| PUT | `/api/admin/products/:id/stores` | `backend/src/modules/admin/assignments.ts:70` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/products/:id/sync` | `backend/src/modules/admin/assignments.ts:112` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/sales/summary` | `backend/src/modules/admin/assignments.ts:129` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/loyalty/ops` | `backend/src/modules/admin/assignments.ts:169` | X-Admin-Token (owner/manager/viewer) |

**`admin/console.ts`**

| Метод | Полный путь | Обработчик | Авторизация |
|---|---|---|---|
| GET | `/api/admin/meta` | `backend/src/modules/admin/console.ts:158` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/evotor/health` | `backend/src/modules/admin/console.ts:161` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/dashboard` | `backend/src/modules/admin/console.ts:164` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/business-events` | `backend/src/modules/admin/console.ts:235` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/operations.csv` | `backend/src/modules/admin/console.ts:267` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/operations` | `backend/src/modules/admin/console.ts:285` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/operations/:store/:doc` | `backend/src/modules/admin/console.ts:290` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/customers` | `backend/src/modules/admin/console.ts:302` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/customers/:id` | `backend/src/modules/admin/console.ts:327` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/customers/:id/phone` | `backend/src/modules/admin/console.ts:375` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/voucher-templates` | `backend/src/modules/admin/console.ts:393` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/vouchers/grant-all/preview` | `backend/src/modules/admin/console.ts:396` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/customers/:id/vouchers` | `backend/src/modules/admin/console.ts:404` | X-Admin-Token (owner/manager/viewer) |
| PATCH | `/api/admin/products/:id` | `backend/src/modules/admin/console.ts:416` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/products/bulk` | `backend/src/modules/admin/console.ts:440` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/products.csv` | `backend/src/modules/admin/console.ts:496` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/audit` | `backend/src/modules/admin/console.ts:520` | X-Admin-Token (owner/manager/viewer) |

**`admin/evotorCatalog.ts`**

| Метод | Полный путь | Обработчик | Авторизация |
|---|---|---|---|
| GET | `/api/admin/evotor/stores` | `backend/src/modules/admin/evotorCatalog.ts:90` | X-Admin-Token (owner/manager/viewer) |
| PATCH | `/api/admin/evotor/stores/:storeUuid` | `backend/src/modules/admin/evotorCatalog.ts:142` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/evotor/employees` | `backend/src/modules/admin/evotorCatalog.ts:155` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/evotor/sync` | `backend/src/modules/admin/evotorCatalog.ts:184` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/evotor/stores/:storeUuid/sync` | `backend/src/modules/admin/evotorCatalog.ts:231` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/evotor/stores/:storeUuid/push-products` | `backend/src/modules/admin/evotorCatalog.ts:247` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/evotor/stores/:storeUuid/products` | `backend/src/modules/admin/evotorCatalog.ts:257` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/evotor/stores/:storeUuid/products/drift` | `backend/src/modules/admin/evotorCatalog.ts:277` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/evotor/stores/:storeUuid/wipe-catalog` | `backend/src/modules/admin/evotorCatalog.ts:287` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/evotor/poll` | `backend/src/modules/admin/evotorCatalog.ts:299` | X-Admin-Token (owner/manager/viewer) |

**`admin/evotorTokens.ts`**

| Метод | Полный путь | Обработчик | Авторизация |
|---|---|---|---|
| GET | `/api/admin/evotor/tokens` | `backend/src/modules/admin/evotorTokens.ts:18` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/evotor/tokens` | `backend/src/modules/admin/evotorTokens.ts:22` | X-Admin-Token (owner/manager/viewer) |
| PATCH | `/api/admin/evotor/tokens/:id` | `backend/src/modules/admin/evotorTokens.ts:49` | X-Admin-Token (owner/manager/viewer) |
| DELETE | `/api/admin/evotor/tokens/:id` | `backend/src/modules/admin/evotorTokens.ts:75` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/evotor/tokens/:id/probe` | `backend/src/modules/admin/evotorTokens.ts:86` | X-Admin-Token (owner/manager/viewer) |

**`admin/routes.ts`**

| Метод | Полный путь | Обработчик | Авторизация |
|---|---|---|---|
| GET | `/api/admin/me` | `backend/src/modules/admin/routes.ts:142` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/logs` | `backend/src/modules/admin/routes.ts:165` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/logs/test` | `backend/src/modules/admin/routes.ts:180` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/stats` | `backend/src/modules/admin/routes.ts:186` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/reset` | `backend/src/modules/admin/routes.ts:201` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/organizations` | `backend/src/modules/admin/routes.ts:213` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/organizations/:id` | `backend/src/modules/admin/routes.ts:222` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/organizations` | `backend/src/modules/admin/routes.ts:233` | X-Admin-Token (owner/manager/viewer) |
| PATCH | `/api/admin/organizations/:id` | `backend/src/modules/admin/routes.ts:251` | X-Admin-Token (owner/manager/viewer) |
| DELETE | `/api/admin/organizations/:id` | `backend/src/modules/admin/routes.ts:282` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/stores` | `backend/src/modules/admin/routes.ts:291` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/stores/:id` | `backend/src/modules/admin/routes.ts:302` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/stores` | `backend/src/modules/admin/routes.ts:315` | X-Admin-Token (owner/manager/viewer) |
| PATCH | `/api/admin/stores/:id` | `backend/src/modules/admin/routes.ts:328` | X-Admin-Token (owner/manager/viewer) |
| DELETE | `/api/admin/stores/:id` | `backend/src/modules/admin/routes.ts:353` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/devices` | `backend/src/modules/admin/routes.ts:362` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/devices` | `backend/src/modules/admin/routes.ts:373` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/devices/:id/revoke` | `backend/src/modules/admin/routes.ts:383` | X-Admin-Token (owner/manager/viewer) |
| DELETE | `/api/admin/devices/:id` | `backend/src/modules/admin/routes.ts:389` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/cashier/menu` | `backend/src/modules/admin/routes.ts:400` | X-Admin-Token (owner/manager/viewer) |
| PATCH | `/api/admin/cashier/menu` | `backend/src/modules/admin/routes.ts:424` | X-Admin-Token (owner/manager/viewer) |
| DELETE | `/api/admin/cashier/menu` | `backend/src/modules/admin/routes.ts:448` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/categories` | `backend/src/modules/admin/routes.ts:454` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/categories/:id` | `backend/src/modules/admin/routes.ts:462` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/categories` | `backend/src/modules/admin/routes.ts:472` | X-Admin-Token (owner/manager/viewer) |
| PATCH | `/api/admin/categories/:id` | `backend/src/modules/admin/routes.ts:485` | X-Admin-Token (owner/manager/viewer) |
| DELETE | `/api/admin/categories/:id` | `backend/src/modules/admin/routes.ts:506` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/products` | `backend/src/modules/admin/routes.ts:515` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/products` | `backend/src/modules/admin/routes.ts:551` | X-Admin-Token (owner/manager/viewer) |
| DELETE | `/api/admin/products/:id` | `backend/src/modules/admin/routes.ts:632` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/product-groups` | `backend/src/modules/admin/routes.ts:664` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/product-groups` | `backend/src/modules/admin/routes.ts:688` | X-Admin-Token (owner/manager/viewer) |
| DELETE | `/api/admin/product-groups/:id` | `backend/src/modules/admin/routes.ts:815` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/modifiers/backfill-products` | `backend/src/modules/admin/routes.ts:824` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/modifiers` | `backend/src/modules/admin/routes.ts:841` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/modifiers` | `backend/src/modules/admin/routes.ts:853` | X-Admin-Token (owner/manager/viewer) |
| DELETE | `/api/admin/modifiers/:id` | `backend/src/modules/admin/routes.ts:895` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/modifier-schemes/:id/preview` | `backend/src/modules/admin/routes.ts:908` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/addon-groups` | `backend/src/modules/admin/routes.ts:922` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/modifier-schemes` | `backend/src/modules/admin/routes.ts:924` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/modifier-schemes` | `backend/src/modules/admin/routes.ts:954` | X-Admin-Token (owner/manager/viewer) |
| DELETE | `/api/admin/modifier-schemes/:id` | `backend/src/modules/admin/routes.ts:1046` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/catalog/quality` | `backend/src/modules/admin/routes.ts:1059` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/products/:id/availability` | `backend/src/modules/admin/routes.ts:1081` | X-Admin-Token (owner/manager/viewer) |
| PUT | `/api/admin/products/:id/availability` | `backend/src/modules/admin/routes.ts:1090` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/referrals` | `backend/src/modules/admin/routes.ts:1107` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/promos` | `backend/src/modules/admin/routes.ts:1124` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/promos` | `backend/src/modules/admin/routes.ts:1142` | X-Admin-Token (owner/manager/viewer) |
| PATCH | `/api/admin/promos/:id` | `backend/src/modules/admin/routes.ts:1182` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/promos/:id/publish` | `backend/src/modules/admin/routes.ts:1243` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/promos/:id/unpublish` | `backend/src/modules/admin/routes.ts:1254` | X-Admin-Token (owner/manager/viewer) |
| DELETE | `/api/admin/promos/:id` | `backend/src/modules/admin/routes.ts:1262` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/vouchers/grant-all` | `backend/src/modules/admin/routes.ts:1267` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/disputes` | `backend/src/modules/admin/routes.ts:1277` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/cashback/:userId` | `backend/src/modules/admin/routes.ts:1281` | X-Admin-Token (owner/manager/viewer) |

**`admin/stock.ts`**

| Метод | Полный путь | Обработчик | Авторизация |
|---|---|---|---|
| GET | `/api/admin/stock/items` | `backend/src/modules/admin/stock.ts:63` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/stock/items/:id` | `backend/src/modules/admin/stock.ts:90` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/stock/items` | `backend/src/modules/admin/stock.ts:127` | X-Admin-Token (owner/manager/viewer) |
| PATCH | `/api/admin/stock/items/:id` | `backend/src/modules/admin/stock.ts:152` | X-Admin-Token (owner/manager/viewer) |
| DELETE | `/api/admin/stock/items/:id` | `backend/src/modules/admin/stock.ts:179` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/stock/balances` | `backend/src/modules/admin/stock.ts:192` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/stock/expiry` | `backend/src/modules/admin/stock.ts:211` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/stock/norms` | `backend/src/modules/admin/stock.ts:255` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/stock/norms` | `backend/src/modules/admin/stock.ts:276` | X-Admin-Token (owner/manager/viewer) |
| DELETE | `/api/admin/stock/norms/:id` | `backend/src/modules/admin/stock.ts:298` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/stock/products-without-norms` | `backend/src/modules/admin/stock.ts:305` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/suppliers` | `backend/src/modules/admin/stock.ts:320` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/suppliers` | `backend/src/modules/admin/stock.ts:332` | X-Admin-Token (owner/manager/viewer) |
| PATCH | `/api/admin/suppliers/:id` | `backend/src/modules/admin/stock.ts:356` | X-Admin-Token (owner/manager/viewer) |
| DELETE | `/api/admin/suppliers/:id` | `backend/src/modules/admin/stock.ts:380` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/purchases/invoices` | `backend/src/modules/admin/stock.ts:392` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/purchases/invoices/:id` | `backend/src/modules/admin/stock.ts:413` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/purchases/invoices` | `backend/src/modules/admin/stock.ts:440` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/purchases/invoices/:id/post` | `backend/src/modules/admin/stock.ts:491` | X-Admin-Token (owner/manager/viewer) |
| DELETE | `/api/admin/purchases/invoices/:id` | `backend/src/modules/admin/stock.ts:544` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/purchases/payments` | `backend/src/modules/admin/stock.ts:554` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/purchases/debt` | `backend/src/modules/admin/stock.ts:606` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/inventory` | `backend/src/modules/admin/stock.ts:624` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/inventory` | `backend/src/modules/admin/stock.ts:635` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/inventory/:id` | `backend/src/modules/admin/stock.ts:679` | X-Admin-Token (owner/manager/viewer) |
| PATCH | `/api/admin/inventory/:id/lines` | `backend/src/modules/admin/stock.ts:702` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/inventory/:id/post` | `backend/src/modules/admin/stock.ts:732` | X-Admin-Token (owner/manager/viewer) |

**`admin/studio.ts`**

| Метод | Полный путь | Обработчик | Авторизация |
|---|---|---|---|
| GET | `/api/admin/purchases/snapshot` | `backend/src/modules/admin/studio.ts:239` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/purchases/payments` | `backend/src/modules/admin/studio.ts:253` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/purchases/invoices/:id/receive` | `backend/src/modules/admin/studio.ts:256` | X-Admin-Token (owner/manager/viewer) |
| PATCH | `/api/admin/suppliers/:id/legal` | `backend/src/modules/admin/studio.ts:264` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/purchases/orders` | `backend/src/modules/admin/studio.ts:297` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/purchases/orders` | `backend/src/modules/admin/studio.ts:299` | X-Admin-Token (owner/manager/viewer) |
| PATCH | `/api/admin/purchases/orders/:id` | `backend/src/modules/admin/studio.ts:332` | X-Admin-Token (owner/manager/viewer) |
| DELETE | `/api/admin/purchases/orders/:id` | `backend/src/modules/admin/studio.ts:366` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/purchases/orders/:id/to-invoice` | `backend/src/modules/admin/studio.ts:376` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/purchases/order-helper` | `backend/src/modules/admin/studio.ts:403` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/purchases/returns` | `backend/src/modules/admin/studio.ts:425` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/purchases/returns` | `backend/src/modules/admin/studio.ts:427` | X-Admin-Token (owner/manager/viewer) |
| PATCH | `/api/admin/purchases/returns/:id` | `backend/src/modules/admin/studio.ts:453` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/purchases/returns/:id/post` | `backend/src/modules/admin/studio.ts:481` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/purchases/reconciliations` | `backend/src/modules/admin/studio.ts:520` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/purchases/reconciliations` | `backend/src/modules/admin/studio.ts:522` | X-Admin-Token (owner/manager/viewer) |
| PATCH | `/api/admin/purchases/reconciliations/:id` | `backend/src/modules/admin/studio.ts:542` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/purchases/bank-rows` | `backend/src/modules/admin/studio.ts:562` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/purchases/bank-rows` | `backend/src/modules/admin/studio.ts:564` | X-Admin-Token (owner/manager/viewer) |
| DELETE | `/api/admin/purchases/bank-rows/:id` | `backend/src/modules/admin/studio.ts:594` | X-Admin-Token (owner/manager/viewer) |
| PATCH | `/api/admin/purchases/bank-rows/:id` | `backend/src/modules/admin/studio.ts:603` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/stock/recipes` | `backend/src/modules/admin/studio.ts:647` | X-Admin-Token (owner/manager/viewer) |
| PUT | `/api/admin/stock/recipes/:productId` | `backend/src/modules/admin/studio.ts:669` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/stock/consumption` | `backend/src/modules/admin/studio.ts:695` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/stock/snapshot` | `backend/src/modules/admin/studio.ts:714` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/inventory/overview` | `backend/src/modules/admin/studio.ts:751` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/inventory/:id/sheet` | `backend/src/modules/admin/studio.ts:762` | X-Admin-Token (owner/manager/viewer) |
| PATCH | `/api/admin/inventory/:id/meta` | `backend/src/modules/admin/studio.ts:775` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/inventory/:id/recount` | `backend/src/modules/admin/studio.ts:799` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/inventory/:id/submit` | `backend/src/modules/admin/studio.ts:818` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/inventory/:id/cancel` | `backend/src/modules/admin/studio.ts:830` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/ai/feed` | `backend/src/modules/admin/studio.ts:840` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/ai/feed/:key/hide` | `backend/src/modules/admin/studio.ts:842` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/ai/draft/payment` | `backend/src/modules/admin/studio.ts:851` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/analytics/overview` | `backend/src/modules/admin/studio.ts:862` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/analytics/heatmap` | `backend/src/modules/admin/studio.ts:905` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/analytics/staff` | `backend/src/modules/admin/studio.ts:918` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/analytics/affinity` | `backend/src/modules/admin/studio.ts:937` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/analytics/customers` | `backend/src/modules/admin/studio.ts:946` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/analytics/window` | `backend/src/modules/admin/studio.ts:971` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/referrals/pairs` | `backend/src/modules/admin/studio.ts:982` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/analytics/compare` | `backend/src/modules/admin/studio.ts:997` | X-Admin-Token (owner/manager/viewer) |

**`analytics/routes.ts`**

| Метод | Полный путь | Обработчик | Авторизация |
|---|---|---|---|
| POST | `/api/analytics/events` | `backend/src/modules/analytics/routes.ts:9` | нет (whitelist событий) |

**`auth/routes.ts`**

| Метод | Полный путь | Обработчик | Авторизация |
|---|---|---|---|
| POST | `/api/auth/guest` | `backend/src/modules/auth/routes.ts:32` | нет |
| POST | `/api/auth/recovery` | `backend/src/modules/auth/routes.ts:45` | нет |
| POST | `/api/auth/restore` | `backend/src/modules/auth/routes.ts:50` | нет |

**`dev/routes.ts`**

| Метод | Полный путь | Обработчик | Авторизация |
|---|---|---|---|
| POST | `/api/dev/login` | `backend/src/modules/dev/routes.ts:16` | только dev (404 в prod) |
| GET | `/api/dev/users` | `backend/src/modules/dev/routes.ts:24` | только dev (404 в prod) |
| POST | `/api/dev/reset` | `backend/src/modules/dev/routes.ts:33` | только dev (404 в prod) |

**`devices/routes.ts`**

| Метод | Полный путь | Обработчик | Авторизация |
|---|---|---|---|
| GET | `/api/devices/ping` | `backend/src/modules/devices/routes.ts:24` | публичный (диагностика) |
| POST | `/api/devices/loyalty/resolve` | `backend/src/modules/devices/routes.ts:41` | evotorProxyStrict + обязателен EVOTOR_PROXY_TOKEN |
| POST | `/api/devices/logs` | `backend/src/modules/devices/routes.ts:78` | evotorProxyStrict + обязателен EVOTOR_PROXY_TOKEN |
| POST | `/api/devices/enroll` | `backend/src/modules/devices/routes.ts:94` | код регистрации (одноразовый) |
| GET | `/api/devices/images/:file` | `backend/src/modules/devices/routes.ts:129` | публичный (при ENFORCE — Authorization) |
| GET | `/api/devices/whoami` | `backend/src/modules/devices/routes.ts:165` | публичный |
| GET | `/api/devices/catalog` | `backend/src/modules/devices/routes.ts:250` | публичный read-only (по замыслу) |
| POST | `/api/devices/sync` | `backend/src/modules/devices/routes.ts:540` | X-Device-Token (requireDevice) |
| POST | `/api/devices/sales` | `backend/src/modules/devices/routes.ts:546` | X-Device-Token (requireDevice) |

**`directory/routes.ts`**

| Метод | Полный путь | Обработчик | Авторизация |
|---|---|---|---|
| GET | `/api/directory` | `backend/src/modules/directory/routes.ts:207` | нет; /staff — X-Device-Token |
| GET | `/api/directory/staff` | `backend/src/modules/directory/routes.ts:212` | нет; /staff — X-Device-Token |

**`game/routes.ts`**

| Метод | Полный путь | Обработчик | Авторизация |
|---|---|---|---|
| GET | `/api/game/status` | `backend/src/modules/game/routes.ts:39` | JWT (requireAuth) |
| POST | `/api/game/start` | `backend/src/modules/game/routes.ts:51` | JWT (requireAuth) |
| POST | `/api/game/claim` | `backend/src/modules/game/routes.ts:69` | JWT (requireAuth) |

**`game/runner.ts`**

| Метод | Полный путь | Обработчик | Авторизация |
|---|---|---|---|
| GET | `/api/game/runner/meta` | `backend/src/modules/game/runner.ts:40` | JWT (requireAuth) |
| GET | `/api/game/runner/progress` | `backend/src/modules/game/runner.ts:55` | JWT (requireAuth) |
| POST | `/api/game/runner/runs` | `backend/src/modules/game/runner.ts:64` | JWT (requireAuth) |

**`logs/routes.ts`**

| Метод | Полный путь | Обработчик | Авторизация |
|---|---|---|---|
| POST | `/api/client-logs` | `backend/src/modules/logs/routes.ts:66` | нет (rate limit по IP) |

**`loyalty/cardLookup.ts`**

| Метод | Полный путь | Обработчик | Авторизация |
|---|---|---|---|
| GET | `/api/loyalty/card` | `backend/src/modules/loyalty/cardLookup.ts:61` | JWT (requireAuth) |

**`public/routes.ts`**

| Метод | Полный путь | Обработчик | Авторизация |
|---|---|---|---|
| GET | `/api/public/content` | `backend/src/modules/public/routes.ts:21` | нет |

**`staff/adminRoutes.ts`**

| Метод | Полный путь | Обработчик | Авторизация |
|---|---|---|---|
| GET | `/api/admin/staff` | `backend/src/modules/staff/adminRoutes.ts:8` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/staff` | `backend/src/modules/staff/adminRoutes.ts:16` | X-Admin-Token (owner/manager/viewer) |
| DELETE | `/api/admin/staff/:id` | `backend/src/modules/staff/adminRoutes.ts:44` | X-Admin-Token (owner/manager/viewer) |
| PUT | `/api/admin/staff/:id/device` | `backend/src/modules/staff/adminRoutes.ts:50` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/staff/schedule` | `backend/src/modules/staff/adminRoutes.ts:63` | X-Admin-Token (owner/manager/viewer) |
| PUT | `/api/admin/staff/schedule` | `backend/src/modules/staff/adminRoutes.ts:74` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/staff/wish-rules` | `backend/src/modules/staff/adminRoutes.ts:102` | X-Admin-Token (owner/manager/viewer) |
| POST | `/api/admin/staff/wish-rules` | `backend/src/modules/staff/adminRoutes.ts:111` | X-Admin-Token (owner/manager/viewer) |
| GET | `/api/admin/staff/wishes` | `backend/src/modules/staff/adminRoutes.ts:136` | X-Admin-Token (owner/manager/viewer) |
| PUT | `/api/admin/staff/wishes/:id` | `backend/src/modules/staff/adminRoutes.ts:150` | X-Admin-Token (owner/manager/viewer) |

**`staff/deviceRoutes.ts`**

| Метод | Полный путь | Обработчик | Авторизация |
|---|---|---|---|
| GET | `/api/devices/shift/summary` | `backend/src/modules/staff/deviceRoutes.ts:20` | EVOTOR_PROXY_TOKEN (evotorProxy) |
| GET | `/api/devices/shift/team` | `backend/src/modules/staff/deviceRoutes.ts:59` | EVOTOR_PROXY_TOKEN (evotorProxy) |
| GET | `/api/devices/timesheet` | `backend/src/modules/staff/deviceRoutes.ts:87` | EVOTOR_PROXY_TOKEN (evotorProxy) |
| GET | `/api/devices/timesheet/wishes` | `backend/src/modules/staff/deviceRoutes.ts:154` | EVOTOR_PROXY_TOKEN (evotorProxy) |
| PUT | `/api/devices/timesheet/wishes` | `backend/src/modules/staff/deviceRoutes.ts:256` | EVOTOR_PROXY_TOKEN (evotorProxy) |
| POST | `/api/devices/timesheet/wishes` | `backend/src/modules/staff/deviceRoutes.ts:326` | EVOTOR_PROXY_TOKEN (evotorProxy) |
| GET | `/api/devices/shift/breaks` | `backend/src/modules/staff/deviceRoutes.ts:379` | EVOTOR_PROXY_TOKEN (evotorProxy) |
| GET | `/api/devices/breaks/recommendation` | `backend/src/modules/staff/deviceRoutes.ts:422` | EVOTOR_PROXY_TOKEN (evotorProxy) |
| POST | `/api/devices/shift/breaks/start` | `backend/src/modules/staff/deviceRoutes.ts:456` | EVOTOR_PROXY_TOKEN (evotorProxy) |
| POST | `/api/devices/shift/breaks/end` | `backend/src/modules/staff/deviceRoutes.ts:478` | EVOTOR_PROXY_TOKEN (evotorProxy) |

**`sync/routes.ts`**

| Метод | Полный путь | Обработчик | Авторизация |
|---|---|---|---|
| GET | `/api/sync/history` | `backend/src/modules/sync/routes.ts:14` | JWT (requireAuth) |
| POST | `/api/sync` | `backend/src/modules/sync/routes.ts:49` | JWT (requireAuth) |

**`upload/routes.ts`**

| Метод | Полный путь | Обработчик | Авторизация |
|---|---|---|---|
| POST | `/api/admin/upload` | `backend/src/modules/upload/routes.ts:79` | X-Admin-Token (owner/manager) |

### 4.2 Контракты ключевых методов

Ниже — методы, от которых зависит бизнес; для остальных контракт читается по zod-схеме рядом с обработчиком (строки указаны в §4.1).

#### `GET /api/devices/catalog` — каталог для кассы
- Обработчик: `backend/src/modules/devices/routes.ts:250`. Авторизация: публичный read-only (в APK нет секрета — осознанно, комментарий в коде `:251-253`).
- Query/headers: `storeUuid` или `X-Evotor-Store-Uuid`, `X-Evotor-Device-UUID`.
- Ответ: `products[]` (в т.ч. `articleNumber = sc-<id>`, `groupId`, `variantLabel`, `toppings`, `upsell`, `isModifier`, `isGroup`, `hideFromMenu`), `categories[]`, `groups[]` (варианты), `modifiers/schemes`, `menu { showAllTab, order, hidden }` (`:463-487`).
- Побочные эффекты: нет, только чтение.
- Тесты: `device-catalog.test.ts`, `directory-menu.test.ts`, `catalog-visibility.test.ts`, `evotor-position-fields.test.ts`.
- Статус: код — DONE; влияние на экран кассы — UNVERIFIED (нужен терминал).

#### `POST /api/devices/loyalty/resolve` — карта → состояние лояльности
- Обработчик: `modules/devices/routes.ts:41`. Авторизация: `evotorProxyStrict`, при пустом `EVOTOR_PROXY_TOKEN` — 503 `proxy_not_configured` (`:46`).
- Body: `{ code: string(1..4000) }` — либо подписанный токен (содержит `.`), либо номер карты.
- Rate limit: 60 запросов/мин на устройство/точку через `rate_limits` (`:48-60`).
- Ответ: `cardCode`, `paidCups`, `cupsForFree`, `freeAvailable`, `cashback`, `reservationId`, `reservationExpiresAt`, `freeStatus`; ошибка → 404 с причиной.
- Побочные эффекты: создаёт резерв бонусов (`modules/loyalty/reservations.ts`), идемпотентность по TTL `RESERVATION_TTL_SEC` (по умолчанию 90 с).
- Тесты: `reservations.test.ts` (9), `sell-fixture.test.ts` (5), `loyalty-rules.test.ts`.
- Статус: логика DONE, реальный обмен через прокси — UNVERIFIED.

#### `POST /api/devices/sales` — фискальная продажа с кассы
- Обработчик: `modules/devices/routes.ts:546`. Авторизация: `X-Device-Token` (`requireDevice`, `:545`).
- Body: `cardToken`, `fiscalId`, `amountRub`, `useFree`, `cashbackUseRub`, `items[]` (`docs/DEVICE-SALES.md`).
- Идемпотентность: по `deviceId + fiscalId` **[Ф по документу и коду обработчика]**; тест `sell-fixture.test.ts`.
- **Аномалия:** текущий APK этот метод не вызывает (в APK нет строки `/api/devices/sales`) — см. `AUDIT-API-002`.

#### `GET /api/admin/cashier/menu`, `PATCH`, `DELETE` — меню кассы
- Обработчики: `modules/admin/routes.ts:400`, `:423`, `:448`. Авторизация: `X-Admin-Token`, роль owner/manager (viewer — только GET).
- GET: `?storeUuid=…` (опционально); ответ `{storeUuid, own, showAllTab, hiddenGroups, order, allGroups}`.
- PATCH: `{ storeUuid?, showAllTab?, hiddenGroups?, order? }`; без `storeUuid` пишет общую настройку-наследство (`:437-446`). Валидация: имена групп обязаны существовать в `categories`, иначе 400.
- DELETE: `?storeUuid` обязателен — сброс точки на общую настройку.
- Хранилище: `app_settings` ключи `cashier_menu:<uuid>` и `cashier_menu` (`lib/cashierMenu.ts`).
- Тесты: `cashier-menu.test.ts` (9) — включая наследование общей настройки.
- Статус: DONE (backend+UI), влияние на APK — UNVERIFIED.

#### `POST /api/admin/products` и цепочка выгрузки в облако
- Создание: `modules/admin/routes.ts:551`; сразу ставит в очередь `enqueueProductSync` (`modules/admin/enqueue.ts`) для точек с `sync_enabled=1`.
- Воркер: `integrations/evotor/sync/ProductPushService.ts` — `listLocal(false)` фильтрует `catalog_source='SIXTH_CUP'` (`:226`), `toEvotorProduct()` формирует payload с `article_number = sc-<id>` (`productIdentity.ts`), `pushToStoreInternal` (`:364+`) делает CREATE/PUT в облако и пишет `evotor_outbox`/`evotor_products`.
- Тесты: `evotor-product-sync.test.ts`, `addon-single-entry.test.ts:14` (добавка реально попадает в outbox с `article_number`), `evotor-position-fields.test.ts`.
- Статус: логика DONE на моках; реальный облачный обмен — UNVERIFIED (`AUDIT-CASH-003`).

#### `POST /api/admin/upload` — медиа
- Обработчик: `modules/upload/routes.ts:79`. Авторизация: owner или manager (viewer — 403), rate limit 30/15 мин на IP.
- Body: `multipart/form-data`, поле `file`; разрешены `image/jpeg|png|webp` (≤2 МБ) и `video/mp4|webm` (≤20 МБ); проверяется сигнатура контейнера (`looksLikeVideo`, `:59`), изображения пережимаются в WebP 480/960 (`lib/productImage.ts`).
- Ответ: `{ url, urlFull, key, keyFull, path, bytes }`, где `url` — абсолютный адрес на `PUBLIC_BASE_URL` (по умолчанию `https://app.67coffee.ru`, `:69-71`).
- Тест: `admin-audit-fixes.test.ts` (сигнатуры видео).
- **Аномалия:** админский `uploadFile` возвращает только `url`, `urlFull` не используется ни одним клиентом → `AUDIT-MEDIA-001`.

#### `GET /api/admin/operations` + CSV
- `console.ts:285` (`sqlite` пагинация курсором), `console.ts:267` (CSV: BOM, экранирование, защита от формул — `admin-console.test.ts:43`).
- Клиент: `pages/Operations.tsx`, кнопка CSV → `download()`.

#### `POST /api/admin/evotor/poll` — внеочередной опрос облака
- `evotorCatalog.ts:299`; клиент — `pages/Today.tsx` («Опросить кассу»), `pages/Cash.tsx` («Синхронизировать все» → `POST /evotor/sync`).
- Фоновый аналог: `integrations/evotor/sync/PollService.ts` (интервал `EVOTOR_POLL_INTERVAL_SEC`, окна 15 мин/48 ч/7 дней, тест `poll-service.test.ts`).

### 4.3 Аномалии реестра

**A. Endpoints без клиента (37).** Проверено скриптом: путь маршрута ищется как regex с подстановкой `:param → [^/]+` по тексту всех клиентов (админка, PWA, APK). Результат **[В]** (высокая достоверность для уникальных имён):

| Группа | Маршруты | Оценка |
|---|---|---|
| `admin/assignments.ts` | `GET /overview`, `GET /sales/summary`, `GET /loyalty/ops`, `POST /products/:id/sync` | используются только тестами (`sell-fixture.test.ts:90-96`); UI нет → `AUDIT-API-003` |
| Аналитика `studio.ts` | `/analytics/staff`, `/analytics/affinity`, `/analytics/window`, `/analytics/customers`, `/analytics/compare`, `/referrals/pairs`, `/stock/consumption`, `/stock/snapshot`, `/purchases/snapshot` | часть данных не выведена в UI → `AUDIT-API-003` |
| Организации | `GET/POST/PATCH/DELETE /organizations*` | UI нет (только backend) → `AUDIT-API-004` |
| Устройства | `POST /devices/:id/revoke`, `GET/POST /devices` (нет в UI), `POST /api/devices/enroll` | нет экрана регистрации кассы → `AUDIT-API-001` |
| Прочее | `GET /cashback/:userId`, `POST /modifiers/backfill-products`, `PATCH /inventory/:id/meta`, `PATCH /suppliers/:id/legal` | сервисные/идемпотентные, оставлены осознанно |

**B. Клиентские вызовы без обработчика.** Нет: 76 клиентских путей админки сопоставлены с backend (совпадение 76/76 после учёта query-строк), PWA типизирована `hc<AppType>` → расхождение невозможно на этапе компиляции **[Ф]**.

**C. Дубли по смыслу.** `POST /api/admin/evotor/sync` (все точки) и `POST /api/admin/evotor/stores/:uuid/sync` (одна точка) — два способа одной операции, оба используются UI. Остальные дубли (админка `/classic.html`, легаси `AdminPage.tsx`, мёртвый `devices/addons.ts`) удалены ранее — файлов в репозитории нет **[Ф]**.

**D. Методы без проверок доступа.** `/api/devices/catalog`, `/whoami`, `/images/:file`, `/ping` — публичные по замыслу (в APK нет секрета; комментарии в коде). `/api/devices/sales`, `/sync` — `requireDevice`. Staff-эндпоинты `/api/devices/shift/*`, `/timesheet*`, `/breaks/*` защищены `evotorProxy` в soft-режиме: **при пустом `EVOTOR_PROXY_TOKEN` пропускают всех** (`middleware/evotorProxy.ts:25-38`) → `AUDIT-SEC-001`.

**E. Расхождения документации и кода.**
- `docs/DEVICE-CATALOG-API.md:145` утверждает, что `PATCH /api/admin/cashier/menu` требует `storeUuid`; с `36e93e6` он необязателен (общая настройка) → `AUDIT-DOC-002` (CONFLICT).
- `DEPLOYMENT.md` упоминает PWA-экран `/cashier`; маршрута нет → `AUDIT-DOC-001`.
- `docs/DEVICE-SALES.md` называет `POST /api/devices/sales` «основным путём на кассе», но APK его не вызывает → `AUDIT-API-002`.
- `CODE-AUDIT-2026-10.md:193` сообщает о «заглушках ops/…» в APK — все 7 подэкранов смены имеют реальные рендереры (`MainActivity.kt:3442-3877`) → документ устарел, факт снят.

**F. Методы без тестов (по группам).** `staff/adminRoutes.ts` (10 маршрутов) — 0 тестов; `upload` — только сигнатуры, без успешной загрузки; `public/content` — 0; `devices/images`, `devices/whoami` — 0; `organization*` — 0 (только в `admin-audit-fixes` как список блокировок ролей) → `AUDIT-TEST-001`.

---

## 5. База данных и бизнес-логика

### 5.1 Механизм схемы

Три источника, применяемые при старте (`backend/src/db/index.ts`):
1. `SCHEMA` в `db/schema.ts` — 12 базовых таблиц (`users`, `cards`, `rate_limits`, `stores`, `devices`, `receipts`, `products`, `promos`, `voucher_templates`, `vouchers`, `cashback_ledger`, `disputes`).
2. `CREATE TABLE IF NOT EXISTS` внутри модулей: `evotor_*` (7 таблиц в `integrations/evotor/db.ts`, `tokenStore.ts`, `ProductPushService.ts`), `admin_audit` (`modules/admin/audit.ts`), `modifier_scheme_items_v2` (`modules/catalog/addonScheme.ts`), `loyalty_*` (`modules/admin/assignments.ts`).
3. 29 файлов миграций `db/migrations/001…029` (трекер `schema_migrations`, `db/migrate.ts`).

**[В] Риск:** `CREATE TABLE IF NOT EXISTS` не добавляет колонки в существующую таблицу — в коде уже есть ручная «доводка» (`audit.ts:32-38`, `ALTER TABLE ... ADD COLUMN`). Каждая новая колонка требует такой же заплатки или миграции. Порядок «SCHEMA → inline → миграции» нигде не описан как контракт.

### 5.2 Таблицы (71)

Базовые: `users`, `cards`, `rate_limits`, `stores`, `organizations`, `devices`, `receipts`, `sales_lines`, `cashback_ledger`, `promos`, `vouchers`, `voucher_templates`, `disputes`, `card_denylist`, `loyalty_ledger`, `loyalty_ops`, `loyalty_reservations`.

Каталог: `categories`, `products`, `product_groups`, `product_store_links`, `product_store_availability`, `product_stock_norms`, `product_recipe_modes`, `modifiers`, `modifier_schemes`, `modifier_scheme_items`, `modifier_scheme_items_v2`, `modifier_scheme_options`.

Evotor: `evotor_stores`, `evotor_devices`, `evotor_api_tokens`, `evotor_token_stores`, `evotor_products`, `evotor_docs`, `evotor_outbox`, `evotor_sync_log`, `evotor_sync_state`, `evotor_employees`.

Склад/закупки: `stock_items`, `stock_batches`, `stock_movements`, `suppliers`, `purchase_invoices`, `purchase_invoice_lines`, `purchase_orders`, `purchase_order_lines`, `purchase_payments`, `purchase_payment_alloc`, `supplier_returns`, `supplier_return_lines`, `supplier_reconciliations`, `bank_rows`, `inventory_docs`, `inventory_lines`.

Персонал: `staff_members`, `staff_device_link`, `staff_schedule_days`, `staff_wish_rules`, `staff_wishes`, `staff_breaks` (миграция `021_staff_timesheet.sql`).

Прочее: `app_settings`, `admin_audit`, `push_subscriptions`, `client_analytics_events`, `ai_card_hidden`, `game_sessions`, `game_daily`, `runner_runs`, `runner_progress`, `schema_migrations`.

**Неиспользуемые таблицы (проверено grep по коду):** `push_subscriptions` — 0 ссылок в коде (создана миграцией `018`) → `AUDIT-PUSH-001`.

### 5.3 Целостность и ограничения (подтверждено кодом)

- Остатки меняются только проведёнными документами (`stock.ts:2-3`), партии — FEFO (`stock_batches`).
- Идемпотентность приёма чеков: `receipts` + poll-состояние (`PollService`), повторный документ не начисляет дважды (`sell-fixture.test.ts`, `loyalty-rules.test.ts`); защита от повторных начислений — `loyalty_ops`/`receipts`.
- `UNIQUE(modifiers.linked_product_id)` (`028_unique_modifier_link.sql`) — учтено в `addonScheme.syncModifierProduct` (решение A1).
- Резервы бонусов: `loyalty_reservations` с TTL, освобождение по таймауту (`reservations.test.ts`).
- `product_store_availability` — переопределение доступности по точке, читается и PWA (`directory/routes.ts:55-74`) и кассы.
- Внешних ключей почти нет (SQLite + `PRAGMA foreign_keys` не включается явно) — **[В]** каскадное удаление не гарантировано; удаление сущностей делается кодом (например `DELETE /products/:id` проверяет связи).

### 5.4 Данные в рабочем окружении

Проверялась только схема и код. Реальная production-БД недоступна, локальная `backend/data/sixth-cup.db` игнорируется git и в аудите не изменялась. Превью-БД (`/tmp/sc-admin/sixth-cup.db`) — тестовая, заполнена вручную для проверки интерфейса.

---

## 6. Аудит бизнес-процессов

Для каждого процесса — цепочка «действие пользователя → frontend → API → сервис → БД/интеграция → ответ → отображение» с указанием, где цепочка обрывается.

### A. Каталог и товары

| Шаг | Компонент | Доказательство | Статус |
|---|---|---|---|
| Создание товара | `MenuProducts.tsx` → `POST /api/admin/products` | `routes.ts:551` | DONE |
| Группы/категории | `MenuGroups.tsx` → `/categories` | `routes.ts:454-511` | DONE |
| Варианты (размеры) | `product_groups`, `variantLabel`, `groups[]` в каталоге | `devices/routes.ts:487+`, `product-variants.test.ts` | DONE |
| Добавки и схемы | `/modifiers`, `/modifier-schemes`, `addonScheme.ts` | `addon-*.test.ts` (10 файлов) | DONE |
| Фото | `uploadFile` → `POST /api/admin/upload` → WebP 480/960 | `upload/routes.ts:79-124` | DONE (см. `AUDIT-MEDIA-001`) |
| Видимость/порядок | `sort_order`, `available`, `product_store_availability` | `directory/routes.ts:55-74` | DONE |
| Выгрузка в облако | `enqueueProductSync` → `ProductPushService` | `enqueue.ts`, `ProductPushService.ts:226,364` | UNVERIFIED (облако) |

Обрыв цепочки: последний шаг требует Evotor Cloud. [П] Проверить: CREATE в облаке, выдача UUID, сохранение в `product_store_links`, повторный PUT, появление на терминале.

### B. Кассовая система

| Шаг | Компонент | Доказательство | Статус |
|---|---|---|---|
| Список точек | `GET /api/admin/evotor/stores` + кэш при недоступности | `evotorCatalog.ts:90`, `evotor-stores-fallback.test.ts` | DONE (кэш проверен тестом) |
| Общие/точечные настройки меню | `GET/PATCH/DELETE /cashier/menu` | `routes.ts:400-451`, `cashier-menu.test.ts` | DONE |
| Порядок групп / скрытие / «Всё» | каталог отдаёт `menu {order, hidden, showAllTab}` | `devices/routes.ts:463-487` | код DONE, APK UNVERIFIED |
| Стабильный `articleNumber` | `sc-<id>` / `sc-g-<id>` | `productIdentity.ts` | код DONE, терминал UNVERIFIED |
| Очередь и отправка | `evotor_outbox`, `sync_enabled` | `ProductPushService`, `addon-single-entry.test.ts` | на моках DONE |
| Недоступность облака | кэш + баннер, `GET /evotor/stores` → `stale` | `evotor-stores-fallback.test.ts`, UI-баннер | DONE |
| Восстановление после ошибок | `wipe-catalog`, `drift`, `sync` по точке | `evotorCatalog.ts:231-298` | код DONE, реальные операции UNVERIFIED |

Обрыв: всё после «backend → облако». [П] Нужен тестовый ST5 и токен кабинета.

### C. Лояльность

| Шаг | Компонент | Доказательство | Статус |
|---|---|---|---|
| Выпуск карты | `POST /api/auth/guest` → `ensureCard`, `ensureCardCode` | `auth/routes.ts:32`, `loyalty/proof.ts:22-58` | DONE |
| Подписанный QR | Ed25519-токен (`lib/crypto.ts`, `noble/curves`) | `proof.ts:65-78`, `card-code.test.ts` | DONE (код) |
| Ручной номер карты | `normalizeCardCode` (пробелы/дефисы/ведущие нули) | `proof.ts:11-19`, `card-code.test.ts:5-24` | DONE |
| Поиск карты на кассе | APK: поле «Номер карты или QR» → `/api/devices/loyalty/resolve` | `MainActivity.kt:550-575`, `LoyaltyApi.kt:17` | код DONE, устройство UNVERIFIED |
| Начисление после SELL | poll → `SellHandler` → `loyalty/receipts.ts` | `poll-service.test.ts`, `sell-fixture.test.ts` | на фикстурах DONE, облако UNVERIFIED |
| Бесплатный продукт / прогресс | `freeEarned`, `cupsForFree` (по умолчанию 5) | `loyalty/rules.ts`, `loyalty-rules.test.ts` | DONE |
| Резерв и защита от повторов | `loyalty_reservations` + TTL + rate limit | `reservations.test.ts` | DONE |
| Реферал 3 % | `cashback_ledger.beneficiary_id` | `referral.test.ts` (10) | DONE |
| Ваучеры | `vouchers`, `POST /customers/:id/vouchers`, `grant-all` | `routes.ts:396-414,1267` | DONE |
| Оффлайн | PWA очередь чеков; начисление только на сервере | `lib/customer.ts`, `lib/gameQueue.ts` | DONE |

Обрыв: подтверждение начислений реальным чеком из облака (нужен SELL на тестовом терминале).

### D. Контент и маркетинг

Создание → `POST /api/admin/promos`; заголовок необязателен (`promo-title-optional.test.ts`); медиа — `POST /api/admin/upload` → абсолютный URL; публикация — `POST /promos/:id/publish`, окно дат проверяет `content-availability.test.ts`; выдача гостю — `GET /api/directory` (только `published` в окне, `directory/routes.ts:98-121`) **[Ф]**. Предпросмотр после переоткрытия записи — из БД, локальных blob-URL не сохраняется (`mediaUrlError` отклоняет `file://`/`blob:`/локальные пути) **[Ф]**. Обрыв: нет — процесс замкнут внутри backend + файловой системы.

### E. Закупки, склад, рецептуры, инвентаризация

- Заказ → накладная: `OrdersTab.tsx:128` → `POST /purchases/orders/:id/to-invoice` (`studio.ts:376`), тест `studio.test.ts:27` **[Ф]** — DONE (в `CODE-AUDIT-2026-10.md` это было открытой задачей T5, сейчас закрыто → CONFLICT с устаревшим документом, снят).
- Проведение накладной → партии + долг: `POST /purchases/invoices/:id/post` (`stock.ts:491`), тест `studio.test.ts:27` **[Ф]**.
- Возврат поставщику: `POST /purchases/returns/:id/post` (`studio.ts:481`) — UI `ReturnsTab.tsx` **[Ф]**.
- Банк и сверка: `GET/POST /purchases/bank-rows`, `PATCH /purchases/reconciliations/:id`; ручная привязка строки к накладной — тест `studio.test.ts:51`, UI `BankTab`/`ReconTab` **[Ф]**.
- Рецептуры: `GET/PUT /stock/recipes` (`studio.ts:647`), UI `stock/RecipesTab.tsx` **[Ф]**.
- Инвентаризация: создание → строки → пересчёт → submit/post/cancel (`stock.ts`, `studio.ts`), тест `studio.test.ts:106` **[Ф]**.
- Пробел: правка и удаление поставщика — backend есть, UI нет → `AUDIT-PUR-001`.

### F. Персонал и смена

- Админка заводит сотрудников, привязку device UUID, график, правила пожеланий (`staff/adminRoutes.ts`) **[Ф]**; APK читает `shift/summary|team`, `timesheet`, `wishes`, `breaks` **[Ф]**.
- Пробел: нет ни одного теста на admin-часть (`AUDIT-TEST-001`) → поведение не подтверждено при регрессиях.

---

## 7. Интеграции и устройства

### 7.1 Evotor Cloud API (номенклатура, чеки)

| Параметр | Значение |
|---|---|
| Адаптер | `backend/src/integrations/evotor/client/EvotorClient.ts`, `endpoints.ts` |
| Протокол | HTTPS, `X-Authorization` (токен из `.env` или из `evotor_api_tokens` по точке) |
| Методы | создание/обновление товара, список товаров точки, документы (SELL/PAYBACK), сотрудники |
| Ошибки/повторы | `evotor_outbox` + `evotor_sync_log`, `EVOTOR_FAST_OVERLAP_MIN`, окна poll (`PollService.ts`) |
| Тесты | `evotor-product-sync`, `evotor-position-fields`, `evotor-client-error`, `poll-service`, `sell-fixture` |
| Подтверждено | только на фикстурах/моках |
| Требует проверки | реальный обмен: CREATE/PUT товара, доставка на терминал, ProductExtra, Position в чеке, SELL → poll → начисление |

**Статус: UNVERIFIED.** Признак в окружении аудита: админка отдаёт `Error: EVOTOR_API_TOKEN not set` (проверено в браузере на `/cash`).

### 7.2 Evotor Cloud Proxy (касса ↔ backend)

- `EVOTOR_PROXY_TOKEN` + `EVOTOR_PROXY_ENFORCE` (`middleware/evotorProxy.ts`); APK не содержит секретов, облако подставляет заголовок (`LoyaltyApi.kt:12-17`).
- Жёсткая защита: `/api/devices/loyalty/resolve`, `/api/devices/logs` (503 при отсутствии токена, `routes.ts:46,86`), `/api/devices/shift*`, `/timesheet*`, `/breaks*` (`staff/deviceRoutes.ts:19`).
- **Риск:** при пустом `EVOTOR_PROXY_TOKEN` `evotorProxy` пропускает запросы (soft mode, `evotorProxy.ts:25-38`) → `AUDIT-SEC-001`.
- Тесты: логика middleware не покрыта отдельным тестом (`AUDIT-TEST-001`).

### 7.3 DeepSeek (ИИ-ассистент)

- `AI_BASE_URL` (по умолчанию `https://api.deepseek.com`), `AI_MODEL`, `AI_ASSISTANT=1`, ключ `AI_API_KEY` (`config.ts:19-22`).
- Эндпоинты: `/ai/ask`, `/ai/catalog-advice`, `/ai/content-draft`, `/ai/anomaly-explain`, `/ai/shift-summary`, `/ai/feed`.
- Без ключа: честная ошибка 503, интерфейс объясняет причину (`studio.test.ts:114`, `Assistant.tsx:57`) **[Ф]**.
- **Статус: UNVERIFIED** (нет ключа; внешний биллинговый сервис).

### 7.4 Web Push

- Таблица `push_subscriptions` создана миграцией `018`, но **0 ссылок в коде**; `PUSH_ENABLED` читается в `config.ts:61` и нигде не используется; в PWA нет ни `serviceWorker.pushManager`, ни UI подписки.
- Источник требования: `docs/PUSH.md` (план, не ТЗ). **Статус: MISSING** → `AUDIT-PUSH-001`.

### 7.5 Терминал Эвотор (APK)

| Параметр | Значение |
|---|---|
| Версия | в коммите `216bf88` — `versionCode 117 / 5.1.2`; в рабочем дереве (незакоммичено) — `118 / 5.1.3` (`app/build.gradle.kts:12-13`) |
| Подпись | release использует `signingConfigs.release`, при отсутствии ключа — **debug** (`app/build.gradle.kts:40`) |
| Тесты | 18 файлов `app/src/test`, в аудите не запускались |
| Что проверено кодом | `menu.hidden`/`menu.order` (`MenuTabs.kt:32-33`), ручной ввод карты (`MainActivity.kt:550`), все подэкраны смены, `article_number → ProductTable.ROW_CODE` (`InventoryRepository.kt:114`, `CatalogCache.kt:130`) **[В]** |
| Что требует устройства | фактическое совпадение `ROW_CODE`, ProductExtra, фискальный чек, установка APK, подпись |

**Статус: UNVERIFIED** для всего, что зависит от терминала. Подпись debug-ключом — отдельный риск для распространения (`AUDIT-APK-001`).

---

## 8. Тесты, сборки, качество

### 8.1 Фактический прогон (аудит, коммит `7e67a23`)

| Набор | Команда | Результат |
|---|---|---|
| Backend | `npx vitest run` в `backend/` | **36 файлов, 205 тестов — PASS** |
| Админка | `npx vitest run` в `frontend-admin/` | **4 файла, 18 тестов — PASS** |
| PWA | `npx vitest run` в `frontend/` | **4 файла, 52 теста — PASS** |
| Typecheck | `npm run typecheck` (turbo) | **3/3 — OK** |
| Сборка | `npx turbo run build --force` | **3/3 — OK** |
| APK | `./gradlew testDebugUnitTest` | **не запускалось** (нет в окружении гарантии Android SDK/сети) |

### 8.2 Покрытие по файлам (backend, тестов на файл)

`addon-single-entry` 14 · `admin-console` 18 · `logs` 16 · `admin-audit-fixes` 13 · `foundation` 10 · `referral` 10 · `cashier-menu` 9 · `reservations` 9 · `addons-e2e` 8 · `product-variants` 8 · `studio` 8 · `promo-title-optional` 7 · `card-code` 6 · `catalog-visibility` 6 · `addon-maxcount` 4 · `addons-catalog-regressions` 4 · `evotor-token-store` 4 · `loyalty-extras` 4 · `poll-service` 4 · `addons-category-dedupe` 3 · `device-catalog` 3 · `directory-menu` 3 · `runner-levels` 3 · `content-availability` 2 · `evotor-product-sync` 2 · `evotor-stores-fallback` 2 · `loyalty-rules` 2 · `sync-history` 2 · `uuidv5` 2 · `analytics-series` 1 · `evotor-client-error` 1 · `game-claim` 1 · `runner-tables` 1 · `sell-fixture` 5 · `admin-ui-lib` 5.

Админка: `addonScheme` 4 · `CashierMenuPanel` 4 · `BankTab` 7 · `mediaUrl` 3.
PWA: `menuModel` 19 · `ui` 10 · `alpaca/levels` 6 · `alpaca/core/RunnerCore` 17.

### 8.3 Чего нет в тестах

- UI админки целиком: только чистые функции (18 тестов), ни одного рендер-теста React-компонентов (нет `@testing-library`).
- `staff/adminRoutes.ts` — 0 тестов; `public/content` — 0; `upload` — только сигнатуры; `devices/images`, `devices/whoami` — 0; организации — 0.
- `middleware/evotorProxy.ts` (soft/enforce) — 0 тестов.
- Нет e2e (Playwright/Cypress) — визуальная проверка адаптивности в аудите делалась вручную через браузерные инструменты.
- APK: тесты есть (18 файлов), но прогон не выполнялся.

### 8.4 Состояние репозитория с точки зрения качества

- `TODO/FIXME/HACK` в `backend/src`, `frontend/src`, `frontend-admin/src` — **0** **[Ф]**.
- Мёртвый код: пустой no-op middleware в `backend/src/app.ts:183-197` (ветка `if (existsSync(full) && !full.endsWith('/'))` ничего не делает) → `AUDIT-INFRA-001`.
- `.gitignore` скрывает `backend/src/integrations/evotor/__fixtures__/` — каталог лежит внутри `src`, что опасно (будущие фикстуры молча не попадут в git) → `AUDIT-INFRA-002`.
- Игнорируемые пользовательские `n.md`, `n2.md`, `n3.md` в корне — не часть проекта (`n2.md` ≈ 1,7 МБ лога сессии), в коммиты не попадают **[Ф]**.

---

## 9. Полный список незавершённых задач

Формат каждой задачи: ID · статус · приоритет, затем блоки «источник требования», «фактическое состояние», «доказательство», «затронутые файлы/API/таблицы», «зависимости», «исправление», «приёмка», «тесты», «устройство», «риски». Влияние на бизнес указано в поле приоритета.

### Сводная таблица

| ID | Модуль | Статус | Приоритет | Кратко |
|---|---|---|---|---|
| [AUDIT-CASH-001](#audit-cash-001) | Касса | UNVERIFIED | P1 | `article_number → ProductTable.ROW_CODE` на терминале не подтверждён |
| [AUDIT-CASH-002](#audit-cash-002) | Касса | UNVERIFIED | P1 | Порядок/скрытие групп (`menu.order/hidden`) на экране кассы не подтверждены |
| [AUDIT-CASH-003](#audit-cash-003) | Касса | UNVERIFIED | P1 | Реальный обмен с Evotor Cloud (CREATE/PUT/ProductExtra) не проверен |
| [AUDIT-LOY-001](#audit-loy-001) | Лояльность | UNVERIFIED | P1 | Начисление по реальному фискальному SELL не проверено |
| [AUDIT-APK-001](#audit-apk-001) | APK | BROKEN | P1 | Release может собраться с debug-подписью |
| [AUDIT-SEC-001](#audit-sec-001) | Безопасность | PARTIAL | P1 | `EVOTOR_PROXY_ENFORCE` по умолчанию выключен → staff-эндпоинты без авторизации |
| [AUDIT-API-001](#audit-api-001) | Касса | MISSING | P2 | Нет UI/процесса регистрации кассового устройства (enroll/revoke) |
| [AUDIT-API-002](#audit-api-002) | Касса | CONFLICT | P2 | `POST /api/devices/sales` не вызывается текущим APK |
| [AUDIT-MEDIA-001](#audit-media-001) | Каталог/Контент | PARTIAL | P2 | Абсолютные URL на `PUBLIC_BASE_URL`; `urlFull` не используется |
| [AUDIT-PUSH-001](#audit-push-001) | Уведомления | MISSING | P2 | Web Push не реализован (только таблица и флаг) |
| [AUDIT-AI-001](#audit-ai-001) | ИИ | UNVERIFIED | P2 | Ассистент требует внешний ключ и не проверен |
| [AUDIT-TEST-001](#audit-test-001) | Качество | PARTIAL | P2 | Нет тестов staff-admin, public, upload-success, proxy |
| [AUDIT-TEST-002](#audit-test-002) | Качество | PARTIAL | P2 | Нет компонентных/e2e тестов UI админки |
| [AUDIT-DB-001](#audit-db-001) | БД | PARTIAL | P2 | Схема из трёх источников, риск дрейфа |
| [AUDIT-INFRA-003](#audit-infra-003) | Инфраструктура | MISSING | P2 | Нет CI: тесты и typecheck не автоматизированы |
| [AUDIT-PUR-001](#audit-pur-001) | Закупки | PARTIAL | P3 | Поставщика нельзя изменить/удалить из UI |
| [AUDIT-API-003](#audit-api-003) | API | PARTIAL | P3 | 13 backend-эндпоинтов без клиента (аналитика/overview) |
| [AUDIT-API-004](#audit-api-004) | Организации | MISSING | P3 | CRUD организаций только в backend |
| [AUDIT-INFRA-001](#audit-infra-001) | Инфраструктура | BROKEN | P3 | Пустой no-op middleware в `app.ts` |
| [AUDIT-INFRA-002](#audit-infra-002) | Инфраструктура | PARTIAL | P3 | `.gitignore` скрывает каталог внутри `src/` |
| [AUDIT-DOC-001](#audit-doc-001) | Документация | CONFLICT | P3 | `DEPLOYMENT.md`: PWA-экран `/cashier` не существует |
| [AUDIT-DOC-002](#audit-doc-002) | Документация | CONFLICT | P3 | `DEVICE-CATALOG-API.md` и `CODE-AUDIT-2026-10.md` устарели |
| [AUDIT-FE-001](#audit-fe-001) | Админка | BROKEN | P3 | Бейдж «B PWA» переносится на две строки в карточке контента |
| [AUDIT-APK-002](#audit-apk-002) | APK | PARTIAL | P3 | Незакоммиченное изменение версии в `evotor-app` |

---

### AUDIT-CASH-001
**Касса · идентификация товара. UNVERIFIED · P1** — без стабильного кода строки товар на чеке может не совпасть с товаром в 6.7, тогда начисление чашек и себестоимость ломаются.

- **Источник требования:** `README.md:15-21` («стабильный `article_number=sc-<localProductId>`»), `docs/PRODUCT-SYNC-EVOTOR.md`, `docs/CATALOG-VARIANTS-ADDONS.md`.
- **Фактическое состояние:** backend отдаёт `articleNumber` в каталоге (`devices/routes.ts:447`) и в payload облака (`ProductPushService.toEvotorProduct`). APK читает `articleNumber` (см. `data/*.kt`), но соответствие полю `ProductTable.ROW_CODE` на устройстве не проверено.
- **Доказательство:** backend — `backend/src/modules/catalog/productIdentity.ts` (`productArticleNumber`, `groupArticleNumber`), `evotor-position-fields.test.ts` (5 тестов). APK — `net/CatalogApi.kt:112,365,370` (поле и ключ сопоставления), `data/InventoryRepository.kt:114` (читает `ProductTable.ROW_CODE` в `code`), `data/CatalogCache.kt:130` (совпадение по `articleNumber`). То есть цепочка в коде полная, не подтверждён только реальный ответ терминала.
- **Затронутые файлы:** backend — `productIdentity.ts`, `ProductPushService.ts`, `devices/routes.ts`; APK — `net/CatalogApi.kt`, `data/*`.
- **API:** `GET /api/devices/catalog`, `POST /api/admin/evotor/stores/:uuid/push-products`.
- **Таблицы:** `products`, `evotor_products`, `product_store_links`.
- **Внешние зависимости:** Evotor Cloud + терминал ST5.
- **Исправление (минимальное):** ничего не менять в коде, пока не выполнена проверка; при расхождении — привести `article_number` к требуемому полю в `toEvotorProduct` (одна точка изменения).
- **Приёмка:** на терминале в фискальном чеке `ROW_CODE` равен `sc-<id>` для товара и `sc-g-<id>` для группы; повторная выгрузка не создаёт дубль.
- **Тесты:** существующие `evotor-position-fields.test.ts`; добавить тест на точное имя поля, если оно меняется.
- **Проверка на устройстве:** обязательна.
- **Риски:** зависит от `AUDIT-CASH-003`; ошибка ломает начисления (P1).

### AUDIT-CASH-002
**Касса · меню на экране. UNVERIFIED · P1** — настройки порядка и скрытия групп могут не применяться на кассе, а это основная функция раздела «Касса».

- **Источник требования:** `docs/DEVICE-CATALOG-API.md:120-152`, `docs/ADMIN-GROUPS-TOPPINGS.md`, история задач `ee3eeeb…59ac8cf`, коммит `36e93e6` (общая настройка).
- **Фактическое состояние:** backend формирует `menu {order, hidden, showAllTab}`; APK применяет `hidden` и `order` (`MenuTabs.kt:32-33`, тесты `MenuTabsTest.kt`). Реальный экран не проверялся.
- **Доказательство:** `devices/routes.ts:463-487`, `frontend-admin/src/pages/cash/CashierMenuPanel.tsx`, `backend/src/__tests__/cashier-menu.test.ts`, `directory-menu.test.ts`.
- **Затронутые файлы:** backend `devices/routes.ts`, `lib/cashierMenu.ts`; админка `Cash.tsx`, `CashierMenuPanel.tsx`; APK `data/MenuTabs.kt`.
- **API:** `GET/PATCH/DELETE /api/admin/cashier/menu`, `GET /api/devices/catalog`.
- **Таблицы:** `app_settings` (`cashier_menu`, `cashier_menu:<uuid>`), `categories`.
- **Внешние зависимости:** терминал (обновление APK на кассе).
- **Исправление:** если на кассе порядок не совпадает — править только `MenuTabs.kt` (сопоставление имён групп уже нормализовано `normalize`).
- **Приёмка:** на кассе: чипы в заданном порядке, скрытые группы отсутствуют, «Всё» скрывается/показывается; точка со своей настройкой не зависит от общей.
- **Тесты:** `MenuTabsTest.kt`, `cashier-menu.test.ts` (backend) — уже есть.
- **Проверка на устройстве:** обязательна.
- **Риски:** требует переустановки APK → зависит от `AUDIT-APK-001`.

### AUDIT-CASH-003
**Касса · выгрузка каталога в облако. UNVERIFIED · P1** — без подтверждённого обмена товары не появляются на терминале, продажа невозможна.

- **Источник требования:** `docs/PRODUCT-SYNC-EVOTOR.md`, `docs/TZ-EVOTOR-FULL-v3.md`, `docs/EVOTOR-FACTS.md`.
- **Фактическое состояние:** код и очередь готовы, тесты на моках зелёные; реальный токен в окружении аудита отсутствует.
- **Доказательство:** `ProductPushService.ts` (`listLocal` фильтр `catalog_source='SIXTH_CUP'`, `pushToStoreInternal`), `enqueue.ts`, `evotor-product-sync.test.ts`, `addon-single-entry.test.ts` (14 тестов), `evotor-client-error.test.ts`.
- **Затронутые файлы:** `integrations/evotor/**`, `modules/admin/enqueue.ts`, `modules/admin/evotorCatalog.ts`.
- **API:** `POST /api/admin/products`, `POST /api/admin/evotor/stores/:uuid/push-products`, `POST /api/admin/evotor/stores/:uuid/sync`, `POST /api/admin/evotor/poll`.
- **Таблицы:** `evotor_outbox`, `evotor_products`, `evotor_sync_log`, `product_store_links`.
- **Внешние зависимости:** токен кабинета Эвотор, тестовый магазин.
- **Исправление:** только по результатам проверки; вероятные точки — payload CREATE/PUT и заголовки.
- **Приёмка:** товар, созданный в админке, появляется в кабинете Эвотор и на терминале; изменение цены/фото доезжает повторным PUT; при недоступном облаке операция остаётся в outbox и повторяется.
- **Тесты:** после проверки — фиксация реального ответа как фикстуры (без секретов).
- **Проверка на устройстве:** обязательна.
- **Риски:** блокирует весь каталог и лояльность; зависит от доступности кабинета.

### AUDIT-LOY-001
**Лояльность · начисление по реальному чеку. UNVERIFIED · P1** — если poll/SellHandler не разберёт настоящий документ, гость не получит чашки; это ядро продукта.

- **Источник требования:** `README.md:24-28`, `docs/SCAN-RECEIPT-RU.md`, `docs/DEVICE-SALES.md`.
- **Фактическое состояние:** начисление по фикстуре SELL проверено (`sell-fixture.test.ts` 5 тестов), реальный документ из облака — нет.
- **Доказательство:** `integrations/evotor/sync/PollService.ts`, `processing/SellHandler.ts`, `modules/loyalty/receipts.ts`, `loyalty/processing` фикстуры (`backend/src/integrations/evotor/__fixtures__/sell-sample.json` — локальный, не в git).
- **Затронутые файлы:** `PollService.ts`, `SellHandler.ts`, `loyalty/receipts.ts`, `loyalty/rules.ts`.
- **API:** `POST /api/admin/evotor/poll`, внутренние вызовы облака.
- **Таблицы:** `receipts`, `loyalty_ops`, `cashback_ledger`, `cards`, `evotor_docs`, `evotor_sync_state`.
- **Внешние зависимости:** терминал + облако.
- **Исправление:** по результатам проверки; ожидаемо — маппинг полей документа.
- **Приёмка:** SELL на терминале → в админке появилась операция с номером карты и `+1 чашка`; повторный poll не дублирует начисление; бесплатный продукт резервируется и списывается один раз.
- **Тесты:** сохранить реальный документ как фикстуру (обезличенный) и добавить в `sell-fixture`.
- **Проверка на устройстве:** обязательна.
- **Риски:** зависит от `AUDIT-CASH-001/003`; ошибка ведёт к неверным начислениям (P1).

### AUDIT-APK-001
**APK · подпись release. BROKEN · P1** — сборка без ключа молча подписывается debug-ключом; установка обновлений поверх другой подписи невозможна, а релиз нельзя отличить от отладочного.

- **Источник требования:** `evotor-app/docs/RELEASE-KEY.md`, комментарий в `app/build.gradle.kts:23-25`.
- **Фактическое состояние:** `signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")` (`app/build.gradle.kts:40`) — при отсутствии переменных окружения релиз собирается debug-ключом.
- **Доказательство:** тот же файл; отсутствие keystore в репозитории.
- **Затронутые файлы:** `evotor-app/app/build.gradle.kts`.
- **API/таблицы:** не применимо.
- **Внешние зависимости:** keystore и пароли вне git.
- **Исправление:** в CI/локально передавать `KEYSTORE_FILE/KEYSTORE_PASSWORD/KEY_ALIAS/KEY_PASSWORD`; опционально — падать с ошибкой при `assembleRelease` без ключа (одна строка условия), если релиз предназначен для распространения.
- **Приёмка:** `./gradlew assembleRelease` без ключа либо собирает подписанный APK, либо явно падает с сообщением; с ключом — подпись совпадает с предыдущими установками.
- **Тесты:** проверка `apksigner verify --print-certs` на артефакте.
- **Проверка на устройстве:** установка на терминал.
- **Риски:** смена подписи требует удаления приложения и потери локальной очереди (`OrderQueue`).

### AUDIT-SEC-001
**Безопасность · авторизация кассовых эндпоинтов. PARTIAL · P1** — в soft-режиме `/api/devices/shift/*`, `/timesheet*`, `/breaks*` доступны без токена, если `EVOTOR_PROXY_TOKEN` не задан; это утечка кадровых данных и возможность подделки отметок.

- **Источник требования:** `docs/P0-SECURITY-NOTES.md`, комментарии `middleware/evotorProxy.ts:25-38`.
- **Фактическое состояние:** при пустом токене middleware пропускает все запросы (`return next()`); при `EVOTOR_PROXY_ENFORCE=1` — 403. В `config.ts` enforce по умолчанию `false`.
- **Доказательство:** `middleware/evotorProxy.ts:25-48`, `staff/deviceRoutes.ts:19`, `staff/adminRoutes.ts` (админ-часть защищена отдельно).
- **Затронутые файлы:** `middleware/evotorProxy.ts`, `config.ts`, `staff/deviceRoutes.ts`.
- **API:** все `/api/devices/shift/*`, `/api/devices/timesheet*`, `/api/devices/breaks/*`.
- **Таблицы:** `staff_*`.
- **Внешние зависимости:** настройка облака Эвотор (инъекция `Authorization`).
- **Исправление:** в production требовать `EVOTOR_PROXY_TOKEN` и `EVOTOR_PROXY_ENFORCE=1` (проверка при старте, как уже сделано для `JWT_SECRET`/`ADMIN_TOKEN` в `config.ts:46-48`).
- **Приёмка:** при `NODE_ENV=production` без токена сервис не стартует или staff-эндпоинты отвечают 403; `docs/` содержит обязательный чек-лист.
- **Тесты:** добавить `evotorProxy` unit-тест (soft/enforce/пустой токен).
- **Проверка на устройстве:** APK должен продолжать работать через прокси с заголовком.
- **Риски:** включение enforce без настройки кабинета ломает кассу → менять вместе с проверкой `AUDIT-APK-001`.

### AUDIT-API-001
**Касса · регистрация устройства. MISSING · P2** — новую кассу нельзя завести из интерфейса: только curl/вручную, что блокирует масштабирование сети и смену терминала.

- **Источник требования:** `CODE-AUDIT-2026-10.md:165` («единственный путь онбординга»), `docs/EVOTOR-PROXY-STAGE1.md`.
- **Фактическое состояние:** backend: `GET /api/admin/devices`, `POST /api/admin/devices` (создаёт запись и код), `POST /devices/:id/revoke`, `DELETE /devices/:id`; устройство регистрируется `POST /api/devices/enroll` (одноразовый `enroll_code`). В админке вызовов `/devices` нет (grep 0).
- **Доказательство:** `modules/admin/routes.ts:362-397`, `modules/devices/routes.ts:94-121`, отсутствие клиента.
- **Затронутые файлы (frontend):** `pages/Cash.tsx` (естественное место) — но задача только для следующего этапа.
- **API:** `GET/POST /api/admin/devices`, `POST /api/admin/devices/:id/revoke`, `DELETE /api/admin/devices/:id`, `POST /api/devices/enroll`.
- **Таблицы:** `devices` (`token_hash`, `enroll_code`, `revoked`, `public_key`).
- **Внешние зависимости:** нет.
- **Исправление:** блок «Устройства» в `/cash` на существующих эндпоинтах и `api()` клиенте; без новых маршрутов.
- **Приёмка:** создать устройство → получить код → `enroll` с терминала → устройство в статусе «активно»; revoke прекращает доступ.
- **Тесты:** backend уже покрыт (`admin-audit-fixes.test.ts:111` — revoke несуществующего 404); нужен UI-тест после реализации.
- **Проверка на устройстве:** да (enroll с терминала).

### AUDIT-API-002
**Касса · `POST /api/devices/sales`. CONFLICT · P2** — документ называет этот путь основным, но текущий APK продажи так не отправляет; неясно, нужен ли маршрут, или APK должен его использовать.

- **Источник требования:** `docs/DEVICE-SALES.md:1-7`, `docs/SCAN-RECEIPT-RU.md:7`.
- **Фактическое состояние:** endpoint реализован и идемпотентен (`deviceId+fiscalId`), покрыт `sell-fixture.test.ts`; в APK строки `/api/devices/sales` нет.
- **Доказательство:** `modules/devices/routes.ts:545-560`; grep по `evotor-app/app/src` — 0.
- **API:** `POST /api/devices/sales`.
- **Таблицы:** `sales_lines`, `receipts`, `evotor_ops`-совместимые начисления.
- **Исправление:** решение продукта — (а) подключить вызов из APK, или (б) пометить маршрут как legacy и обновить документ. Код без решения не менять.
- **Приёмка:** документ и фактический вызов согласованы; тест отражает выбранный сценарий.
- **Проверка на устройстве:** да, если выбран вариант (а).

### AUDIT-MEDIA-001
**Каталог/Контент · адреса медиа. PARTIAL · P2** — в dev/превью загруженное фото получает адрес production-домена, поэтому картинка не откроется локально; кроме того `urlFull` (960 px) не используется нигде.

- **Источник требования:** `docs/PRODUCT-IMAGES.md` (фото ≥800 px), `DEPLOYMENT.md` (env).
- **Фактическое состояние:** `publicBase()` = `PUBLIC_BASE_URL` или `https://app.67coffee.ru` (`upload/routes.ts:69-71`), админка сохраняет абсолютный URL; `urlFull` возвращается, но клиент берёт только `url` (`client.ts:83-99`).
- **Доказательство:** те же строки; grep `urlFull` по клиентам — 0.
- **Затронутые файлы:** `modules/upload/routes.ts`, `frontend-admin/src/api/client.ts`, `pages/MenuProducts.tsx`, `pages/marketing/PromoMediaField.tsx`.
- **API:** `POST /api/admin/upload`, `GET /uploads/:file`.
- **Таблицы:** нет (URL хранится в `products.image_url`, `promos.image_url`).
- **Исправление:** либо сохранять относительный `/uploads/...` (клиенты уже умеют абсолютные адреса при отображении), либо требовать `PUBLIC_BASE_URL` при старте и документировать. Решение требует подтверждения: смена формата затронет существующие записи.
- **Приёмка:** в dev/preview фото открывается по сохранённому адресу; в prod — по HTTPS-домену; старые записи не ломаются.
- **Тесты:** `admin-audit-fixes.test.ts` (сигнатуры) + новый тест на форму URL.
- **Проверка на устройстве:** фото на кассе (через `/api/devices/images/:file`).

### AUDIT-PUSH-001
**Уведомления · Web Push. MISSING · P2** — обещанное напоминание «ещё один напиток до бесплатного» не реализовано; таблица и флаг есть, кода нет.

- **Источник требования:** `docs/PUSH.md` (план, не ТЗ), `PUSH_ENABLED` в `config.ts:61`.
- **Фактическое состояние:** `push_subscriptions` создана миграцией `018`, 0 ссылок в коде; в PWA нет `pushManager`.
- **Доказательство:** grep по `push_subscriptions` → 0 файлов кода; grep `pushManager` в `frontend/src` → 0.
- **Затронутые файлы:** backend (нужен новый сервис + endpoint), PWA (service worker, UI подписки).
- **API:** отсутствуют (нужны `POST /api/push/subscribe`, отправка после SELL).
- **Таблицы:** `push_subscriptions`.
- **Внешние зависимости:** VAPID-ключи, браузерные push-сервисы.
- **Исправление:** подтвердить необходимость фичи, затем реализовать минимально: подписка в PWA + отправка в `SellHandler` при `cupsTowardFree === cupsForFree-1`, не чаще 1/сутки.
- **Приёмка:** подписка сохраняется, push приходит один раз в сутки, отписка работает.
- **Тесты:** unit на «не чаще 1/сутки»; e2e невозможен без браузера.
- **Проверка на устройстве:** iOS/Android PWA.

### AUDIT-AI-001
**ИИ · ассистент. UNVERIFIED · P2** — функции есть, но без ключа не работают; также неясно качество ответов и стоимость.

- **Источник требования:** `docs/AI-ASSISTANT.md`, `pages/Assistant.tsx`, `config.ts:19-22`.
- **Фактическое состояние:** 5 POST-эндпоинтов + лента подсказок; без `AI_API_KEY` — 503 с понятным текстом (`studio.test.ts:114`).
- **Доказательство:** `modules/admin/ai.ts:66-215`, `pages/Assistant.tsx:49-104`.
- **API:** `/api/admin/ai/*`.
- **Таблицы:** `ai_card_hidden`.
- **Внешние зависимости:** DeepSeek (или совместимый endpoint) + ключ.
- **Исправление:** не требуется до появления ключа; при проверке — зафиксировать модель и таймауты.
- **Приёмка:** ответ приходит за <10 с, ошибки сети показываются человеку, кнопка не «висит».
- **Проверка на устройстве:** не требуется (веб).

### AUDIT-TEST-001
**Качество · пробелы тестов backend. PARTIAL · P2** — регрессии в табеле, загрузке файлов и защите кассовых эндпоинтов не поймаются.

- **Источник требования:** `AGENTS.md`/инструкции проекта (зелёные тесты), `CODE-AUDIT-2026-10.md` (методика).
- **Фактическое состояние:** 0 тестов на `staff/adminRoutes.ts` (10 маршрутов), `public/content`, `devices/images`, `devices/whoami`, организации; `upload` — только сигнатуры; `evotorProxy` — 0.
- **Доказательство:** grep по `backend/src/__tests__` на `api/admin/staff`, `api/public`, `devices/images`, `devices/whoami` → нет совпадений.
- **Затронутые файлы:** новые тесты только в существующей структуре `backend/src/__tests__/`.
- **API:** `staff/*`, `public/content`, `devices/images|whoami`, `upload`.
- **Таблицы:** `staff_*`, `app_settings`, `devices`.
- **Исправление:** добавить по одному тесту на группу (happy path + отказ), используя `app.request` и `setup-isolated-db`.
- **Приёмка:** новые тесты падают при поломке соответствующего обработчика.
- **Проверка на устройстве:** нет.

### AUDIT-TEST-002
**Качество · UI-тесты админки. PARTIAL · P2** — 18 тестов проверяют только чистые функции; сломанный рендер страницы или формы обнаружится лишь вручную.

- **Источник требования:** `CODE-AUDIT-2026-10.md:246` («не проверялось»), практика адаптивных изменений `7e67a23`.
- **Фактическое состояние:** нет `@testing-library/react`; компонентных тестов нет.
- **Доказательство:** `frontend-admin/package.json` (devDependencies без testing-library), 4 тестовых файла.
- **Исправление:** добавить минимальный набор (например `CashierMenuPanel`, `OrdersTab`) только после согласования — новая зависимость.
- **Приёмка:** тест ловит регрессию «кнопка без обработчика»/«форма не отправляет».
- **Проверка на устройстве:** нет.

### AUDIT-DB-001
**БД · источники схемы. PARTIAL · P2** — три источника схемы означают, что состояние БД зависит от порядка применения и от версии кода; расхождение проявится только в production.

- **Источник требования:** `db/migrate.ts:8-10` (комментарий о базовых таблицах), `db/schema.ts`.
- **Фактическое состояние:** `SCHEMA` (12 таблиц) + inline `CREATE TABLE IF NOT EXISTS` в 6 файлах + 29 миграций; ручные `ALTER TABLE` (`audit.ts:32-38`).
- **Доказательство:** см. §5.1.
- **Затронутые файлы:** `db/schema.ts`, `db/migrate.ts`, `integrations/evotor/db.ts`, `modules/admin/audit.ts`, `modules/catalog/addonScheme.ts`, `modules/admin/assignments.ts`, `integrations/evotor/tokenStore.ts`, `ProductPushService.ts`.
- **Исправление:** зафиксировать контракт «все новые объекты — только миграцией», существующие inline-блоки оставить; добавить тест «схема после миграций содержит ожидаемые таблицы/колонки».
- **Приёмка:** тест на схему проходит на пустой БД; новый разработчик получает идентичную схему.
- **Риски:** массовая переделка опасна — только инкрементально.

### AUDIT-INFRA-003
**Инфраструктура · CI. MISSING · P2** — ни тесты, ни typecheck не запускаются автоматически; регрессии находятся вручную.

- **Источник требования:** инструкции проекта (зелёные проверки перед коммитом), `package.json`.
- **Фактическое состояние:** каталога `.github/workflows` нет.
- **Доказательство:** `ls -a` в корне — нет `.github`.
- **Исправление:** один workflow: `npm ci`, `npm run typecheck`, три набора тестов, `npm run build`.
- **Приёмка:** PR показывает статус проверок.
- **Риски:** нет (не влияет на runtime).

### AUDIT-PUR-001
**Закупки · поставщики. PARTIAL · P3** — ошибку в названии/ИНН поставщика нельзя исправить из интерфейса, только через API/БД.

- **Источник требования:** `docs/TZ-ADMIN-EVOTOR-SYNC-FULL.md` (раздел закупок), UI «Поставщики».
- **Фактическое состояние:** `POST /suppliers` есть в UI; `PATCH /suppliers/:id`, `DELETE /suppliers/:id`, `PATCH /suppliers/:id/legal` — только backend.
- **Доказательство:** `stock.ts:332-391`, `studio.ts` (`/suppliers/:id/legal`), `Purchases.tsx:66-78`.
- **API:** `PATCH/DELETE /api/admin/suppliers/:id`.
- **Таблицы:** `suppliers`.
- **Исправление:** строка «Изменить» в существующей вкладке «Поставщики» с `api(..., { method: 'PATCH' })`.
- **Приёмка:** изменение названия/ИНН видно после перезагрузки, удаление без связанных документов работает, со связанными — понятная ошибка.
- **Тесты:** backend-тест на 409 при связанных накладных.

### AUDIT-API-003
**API · эндпоинты без клиента. PARTIAL · P3** — 13 методов поддержки аналитики/обзоров не имеют UI: либо данные не видны владельцу, либо код лишний.

- **Фактическое состояние:** см. §4.3.A: `admin/assignments.ts` (4), аналитика `studio.ts` (9).
- **Доказательство:** скрипт сопоставления; единственные потребители — тесты (`sell-fixture.test.ts:90-96`).
- **Исправление:** решение продукта: вывести в существующие разделы (Аналитика/Сотрудники) или удалить. Без решения не трогать.
- **Приёмка:** для каждого метода — либо вызов из UI, либо удаление с обновлением тестов.

### AUDIT-API-004
**Организации · CRUD. MISSING · P3** — юридические лица (ИНН, СНО, НДС) нельзя вести из админки, хотя они нужны кассе для чеков.

- **Источник требования:** `docs/EVOTOR-CABINET-SETUP.md`, поля `organizations` в `store`-ответе каталога.
- **Фактическое состояние:** `GET/POST/PATCH/DELETE /api/admin/organizations*` есть (`routes.ts:213-289`), клиента нет.
- **Доказательство:** grep `organizations` в `frontend-admin/src` → 0.
- **Таблицы:** `organizations`, `stores.organization_id`.
- **Исправление:** подраздел в `/system` или `/cash` на существующих эндпоинтах.
- **Приёмка:** создание организации с СНО/НДС и привязка к точке; касса получает реквизиты в `/api/devices/catalog`.
- **Проверка на устройстве:** чек с корректными реквизитами.

### AUDIT-INFRA-001
**Инфраструктура · мёртвый код. BROKEN · P3** — пустой middleware в горячем пути запросов: читает файловую систему (`existsSync`) на каждый статический запрос и ничего не делает.

- **Доказательство:** `backend/src/app.ts:183-197` — ветка `if (existsSync(full) && !full.endsWith('/')) { /* комментарий */ }`.
- **Исправление:** удалить блок целиком (второй блок `:199+` выполняет фактическую отдачу статики).
- **Приёмка:** статика и `/uploads` работают как раньше; тесты и сборка зелёные.
- **Риски:** минимальные; проверить отдачу `frontend/dist` и `frontend-admin/dist` по `Host`.

### AUDIT-INFRA-002
**Инфраструктура · `.gitignore`. PARTIAL · P3** — правило скрывает каталог внутри `src/`, из-за чего будущие фикстуры молча не попадут в репозиторий.

- **Доказательство:** `.gitignore:8` — `backend/src/integrations/evotor/__fixtures__/`; в каталоге лежит локальный `sell-sample.json`, не используемый кодом.
- **Исправление:** перенести локальные выгрузки в `backend/data/` (уже игнорируется) и убрать правило для `src/`.
- **Приёмка:** `git status` не показывает фикстуры, но новые файлы в `src/**/__fixtures__` отслеживаются.

### AUDIT-DOC-001
**Документация · `DEPLOYMENT.md`. CONFLICT · P3** — документ обещает экран PWA `/cashier`, которого нет; вводит в заблуждение при приёмке.

- **Доказательство:** `DEPLOYMENT.md:7`; `frontend/src/App.tsx:130-157` — маршрута `/cashier` нет.
- **Исправление:** убрать упоминание или описать фактическую навигацию PWA.
- **Приёмка:** документ соответствует роутеру.

### AUDIT-DOC-002
**Документация · устаревшие контракты. CONFLICT · P3** — по документам нельзя понять текущее поведение (обязательность `storeUuid`, наличие «заглушек» в APK, отсутствие кнопки заказа-в-накладную).

- **Доказательство:** `docs/DEVICE-CATALOG-API.md:145` (говорит «`PATCH` требует `storeUuid`») против `routes.ts:423-446`; `CODE-AUDIT-2026-10.md:193` (заглушки ops/…), `:227` (T5) против фактов `MainActivity.kt:3442-3877` и `OrdersTab.tsx:128`.
- **Исправление:** точечно обновить три места; старый аудит помечать как исторический.
- **Приёмка:** документы и код согласованы по этим пунктам.

### AUDIT-FE-001
**Админка · вёрстка. BROKEN · P3** — в карточке контента бейдж «B PWA» переносится на две строки, карточка выглядит разъехавшейся.

- **Доказательство:** `frontend-admin/src/pages/Marketing.tsx` (бейдж статуса в `.content-top`), CSS `.content-top .pill` без `white-space: nowrap` (см. скриншот в аудите).
- **Исправление:** одна строка CSS в существующем правиле `.content-top .pill`.
- **Приёмка:** бейдж в одну строку на 320–1440 px.

### AUDIT-APK-002
**APK · рабочее состояние репозитория. PARTIAL · P3** — в `evotor-app` есть незакоммиченное изменение версии (`117/5.1.2` → `118/5.1.3`); это пользовательская работа, не потерять.

- **Доказательство:** `git status` в `/Users/dmitrijsuvalov/Documents/evotor-app` → `M app/build.gradle.kts`.
- **Исправление:** решение пользователя: закоммитить или откатить; аудит ничего не меняет.

---

## 10. Приоритетный план следующих работ

Порядок учитывает зависимости; реализацию не начинать без отдельного решения.

**Этап 1 — снять неопределённость по устройству и облаку (P1).**
1. `AUDIT-APK-001` (подпись) — без неё нельзя ставить обновления на терминал.
2. `AUDIT-CASH-003` (обмен с облаком) → `AUDIT-CASH-001` (`article_number → ROW_CODE`) → `AUDIT-CASH-002` (`menu.hidden/order`).
3. `AUDIT-LOY-001` (SELL → poll → начисление).
Проверки после этапа: фикстуры реальных ответов обезличены и добавлены в тесты; в админке виден чек и начисление; на терминале порядок групп и скрытие соответствуют настройке.

**Этап 2 — безопасность и предсказуемость (P1).**
4. `AUDIT-SEC-001` (enforce прокси) — только вместе с настройкой кабинета Эвотор.
5. `AUDIT-INFRA-003` (CI) — фиксирует текущие зелёные проверки, чтобы дальнейшие этапы не ломали базу.
Проверки: `npm run typecheck`, три набора тестов, `turbo run build`, касса продолжает работать через прокси.

**Этап 3 — закрыть функциональные пробелы (P2).**
6. `AUDIT-API-001` (регистрация устройства в UI) — независима, опирается на готовый backend.
7. `AUDIT-MEDIA-001` (адреса медиа) — независима, но влияет на существующие записи.
8. `AUDIT-TEST-001` (тесты staff/public/upload/proxy) — независима, снижает риск этапов 4–7.
9. `AUDIT-DB-001` (контракт схемы) — инкрементально, после тестов.
10. `AUDIT-API-002`, `AUDIT-PUSH-001`, `AUDIT-AI-001` — требуют продуктового решения (нужен ли маршрут продаж из APK, нужен ли Web Push, есть ли ключ ИИ).

**Этап 4 — гигиена (P3).** `AUDIT-INFRA-001`, `AUDIT-INFRA-002`, `AUDIT-PUR-001`, `AUDIT-DOC-001/002`, `AUDIT-FE-001`, `AUDIT-API-003/004`, `AUDIT-TEST-002` (новая зависимость — только по согласованию).

**Как избежать регрессий и дублей.** Каждая задача выше адресует существующие маршруты/компоненты; новых экранов и дублирующих реализаций не требуется. Правила: (1) перед изменением — соответствующий существующий тест; (2) после изменения — `typecheck` + три набора тестов + сборка; (3) изменения API документировать в том же коммите (`docs/DEVICE-CATALOG-API.md` и др.); (4) не менять формат хранения без миграции и обратной совместимости; (5) проверять UI в браузере на 390 и 1440 px.

---

## 11. Ограничения аудита

1. **Evotor Cloud не проверялся:** нет токена в окружении (админка отдаёт `Error: EVOTOR_API_TOKEN not set`). Всё, что зависит от облака, — `UNVERIFIED`.
2. **Терминал не проверялся:** APK не собирался и не устанавливался; `article_number/ROW_CODE`, ProductExtra, фискальный чек, `menu.*`, подпись — `UNVERIFIED`.
3. **Android-тесты не запускались** (`./gradlew testDebugUnitTest`): в аудите не гарантировались Android SDK и сеть. Наличие 18 тестовых файлов подтверждено, результат — нет.
4. **Production-БД не проверялась:** только схема и код; данные не читались.
5. **Внешний ИИ (DeepSeek) не вызывался:** нет ключа.
6. **Браузерные проверки** выполнялись в Chromium через инструменты браузера на ширинах 320–1440 px; Safari/iOS (в т.ч. `env(safe-area-inset-*)`, поведение клавиатуры) не проверялись.
7. **Назначение конкретных API-методов** — вывод по коду (путь, обработчик, zod-схема); рантайм-поведение каждого из 223 маршрутов не наблюдалось, кроме выборочно проверенных в превью (`/health`, `/api/admin/cashier/menu`, `/api/admin/meta`, `/api/admin/dashboard`, `/api/admin/evotor/*` без токена → 502/ошибка).
8. **Производительность и нагрузка** не измерялись (`docs/METRICS.md` описывает намерения, не результаты).
9. **Не проверялось:** восстановление после падения процесса, поведение при переполнении диска, ротация ключей (`KEYS_PATH`), срок жизни подписанных QR (`CARD_QR_TTL_SEC`).

### Что конфликтует в требованиях и требует решения пользователя

| Конфликт | Стороны | Что нужно подтвердить |
|---|---|---|
| `PATCH /cashier/menu` без `storeUuid` | `docs/DEVICE-CATALOG-API.md:145` (обязателен) vs код `routes.ts:423-446` (необязателен, общая настройка) | Какая модель действует: только per-store или общая + наследование (сейчас — вторая) |
| `POST /api/devices/sales` | `docs/DEVICE-SALES.md` («основной путь») vs APK (не вызывает) | Нужен ли этот путь вообще |
| Web Push | `docs/PUSH.md` (план) vs отсутствие кода | Входит ли в объём проекта |
| Организации в админке | backend CRUD есть vs UI нет | Нужен ли UI или данные ведутся в кабинете Эвотор |

---

## 12. Git status и подтверждение неизменности

**Основной репозиторий** (`/Users/dmitrijsuvalov/Downloads/sixth-cup`, ветка `main`):

```
$ git status --short
?? AUDIT-6.7-COFFEE-CURRENT-STATE.md
```

- HEAD на момент аудита: `7e67a23` («feat(admin): make the existing admin usable on phones»), `origin/main` = `7e67a23` (ветка синхронизирована до начала аудита).
- Единственное изменение в рабочем дереве — этот файл. Исходники, тесты, конфигурация, миграции, `package.json`, `.gitignore` не изменялись.
- Коммит, push, deploy не выполнялись. Ветки, worktree, stash не создавались.
- Игнорируемые файлы (`n.md`, `n2.md`, `n3.md`, `backend/data/`, `*/dist/`, `.turbo/`) не затрагивались.

**Репозиторий кассы** (`/Users/dmitrijsuvalov/Documents/evotor-app`, ветка `main`, HEAD `216bf88`):

```
$ git status --short
 M app/build.gradle.kts
```

- Это незакоммиченное изменение пользователя (версия `117→118`, `5.1.2→5.1.3`). Аудит его не менял и не откатывал; зафиксировано в `AUDIT-APK-002`.

**Проверки после создания отчёта:** файл существует в корне, Markdown-структура — заголовки, таблицы и оглавление проверены; содержимое сверено с текущими исходниками (строки и маршруты взяты из кода на `7e67a23`); никакие другие файлы не изменялись.

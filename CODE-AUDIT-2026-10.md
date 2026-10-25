# Аудит кода: дубли, мёртвый код, нерабочие функции, остаток работ

**Дата:** 2026-10-25
**Снимок:** коммит `350db5c` (совпадает с `origin/main`).
**Тип работы:** только чтение. Код не изменялся, ничего не откатывалось.

---

## 0. Что изменилось прямо во время аудита

Аудит начат на `378dc1a`, когда в дереве были незакоммиченные правки другой сессии по контракту
добавок. К моменту финализации отчёта они закоммичены и запушены:

```
7938d5a feat(addons): canonical modifier_scheme_options as the single source
7c16e34 feat(admin): scheme editor reads/writes options, required and sugar
350db5c test(addons): end-to-end admin → catalog → APK fixture
```

Проверено после мержа:

| Пункт | Было | Стало |
|---|---|---|
| Две таблицы схем (D8) | каталог читал `options`, админка писала `items` | админка читает/пишет `options`, есть конверсия `items→options` — **закрыто** |
| `required` в админке | нельзя было задать, сохранение обнуляло | поле есть, `required` переживает сохранение — **закрыто** |
| Словарь групп | `{syrup, topping, milk, other}` | добавлен `sugar`, словарь в `frontend-admin/src/lib/addonScheme.ts` — **закрыто** |
| Сквозной тест админка→каталог→APK | не было | `350db5c` — **закрыто** |

**Вывод для агента:** §3 D8 и задачи R1–R3 из прошлого цикла больше не актуальны, повторно не делать.
Всё, что ниже, — сверено с `350db5c`.

---

## 1. Методика и достоверность

| Что проверено | Как | Достоверность |
|---|---|---|
| 213 роутов бэкенда vs вызовы клиентов | скрипт: `\.(get\|post\|put\|patch\|delete)\(\s*'path'` + нормализация `:param`/`${…}`, сверка с `api(...)`/`useApi(...)`/`SC.*(...)`/`fetch` в admin, PWA, APK | высокая для точных совпадений; низкая для «нет потребителя» (динамические пути) — помечено |
| 77 вызовов React-админки vs роуты | точная сверка с учётом методов | высокая (единственный найденный 404 — §2.1) |
| Дубли роутов (метод+путь) | группировка всех регистраций | высокая: **совпадений нет** |
| Мёртвые экспорты/компоненты | поиск имени по всему коду; `≤1` вхождение = только объявление | средняя (не видит динамических импортов) |
| Заглушки | поиск маркеров + чтение кода | высокая |

Не проверялось: живые ответы API, реальный Эвотор, содержимое прод-БД.
Тесты и сборка не запускались: аудит был read-only, а дерево в его начале содержало чужие
незакоммиченные правки. Счётчики роутов сняты на `378dc1a`; всё, что касается добавок,
перепроверено на `350db5c` после мержа.

---

## 2. Нерабочий функционал

### 2.1. `Marketing → Ваучеры` всегда в ошибке — **подтверждено, 404**

* Клиент: [frontend-admin/src/pages/Marketing.tsx:312](frontend-admin/src/pages/Marketing.tsx#L312) — `useApi('/vouchers/templates')`
  → фактический запрос `GET /api/admin/vouchers/templates`
* Бэкенд: [backend/src/modules/admin/console.ts:393](backend/src/modules/admin/console.ts#L393) — `GET /voucher-templates`
* Второй потребитель использует правильный путь: [CustomerCard.tsx](frontend-admin/src/pages/CustomerCard.tsx) → `/voucher-templates`

Правка (одна строка в клиенте): `'/vouchers/templates'` → `'/voucher-templates'`.
Проверка: вкладка «Ваучеры» в Маркетинге открывается без ошибки, список шаблонов виден.

### 2.2. Сверка с банком — API есть, UI нет ни в одной админке

Роуты (все живые, с валидацией):

| Метод | Путь | Где |
|---|---|---|
| GET | `/api/admin/purchases/bank-rows` | [studio.ts:558](backend/src/modules/admin/studio.ts#L558) |
| POST | `/api/admin/purchases/bank-rows` | [studio.ts:560](backend/src/modules/admin/studio.ts#L560) |
| DELETE | `/api/admin/purchases/bank-rows/:id` | [studio.ts:590](backend/src/modules/admin/studio.ts#L590) |
| GET | `/api/admin/purchases/reconciliations` | [studio.ts:516](backend/src/modules/admin/studio.ts#L516) |
| POST | `/api/admin/purchases/reconciliations` | [studio.ts:519](backend/src/modules/admin/studio.ts#L519) |
| PATCH | `/api/admin/purchases/reconciliations/:id` | [studio.ts:539](backend/src/modules/admin/studio.ts#L539) |

Потребителей в UI нет: `grep -rl "bank-rows" frontend-admin/src frontend-admin/public/ui frontend/src` → пусто.
Единственное упоминание — текст в Help: [Help.tsx:106](frontend-admin/src/pages/Help.tsx#L106)
«Сверка (этап 2 / банк) в v1 не интегрирована».

### 2.3. AI-ассистент отдаёт mock без ключа (осознанно)

[backend/src/modules/admin/ai.ts:31](backend/src/modules/admin/ai.ts#L31) — при отсутствии `AI_ASSISTANT=1`
и `AI_API_KEY` возвращается `provider: 'mock'`. В UI это подписано: [Assistant.tsx:72](frontend-admin/src/pages/Assistant.tsx#L72).
Дефектом не считать; задача — только если нужен реальный провайдер.

### 2.4. Функционал разорван между двумя админками — **корневая причина «не работает»**

Оба интерфейса живые и ходят в один `/api/admin`:

| Интерфейс | Вход | Чем отдаётся |
|---|---|---|
| Статический прототип | `/` | [frontend-admin/index.html](frontend-admin/index.html) (2474 стр.) + [public/ui/coffee.js](frontend-admin/public/ui/coffee.js) (382 КБ) + [public/ui/sc-api.js](frontend-admin/public/ui/sc-api.js) |
| React | `/classic.html` | [frontend-admin/src](frontend-admin/src) — 19 экранов |

Разделение фич (проверено grep по потребителям):

| Фича | Статическая админка | React-админка |
|---|---|---|
| Сверки (`purchases/reconciliations`) | да | **нет** |
| Заказы поставщикам + `order-helper` | да | **нет** |
| Возвраты (`purchases/returns`) | да | **нет** |
| Рецептуры (`stock/recipes`) | да | **нет** |
| Банковские строки | нет | нет |

Следствие: пользователь, открывший `/classic.html`, честно не находит половину закупок и склада.

---

## 3. Дубли и мёртвый код

| # | Что | Где | Объём | Как проверить |
|---|---|---|---|---|
| D1 | Две полноценные админки | см. §2.4 | ~600 КБ UI | открыть `/` и `/classic.html` |
| D2 | Легаси-админка в навигации | [App.tsx:89](frontend-admin/src/App.tsx#L89), [Shell.tsx:42](frontend-admin/src/layout/Shell.tsx#L42) | [AdminPage.tsx](frontend-admin/src/pages/AdminPage.tsx) — 1229 стр. | дублирует Today/Operations/Menu/Cash/Stock/Marketing |
| D3 | Мёртвый UI-бандл | [public/ui/coffee.orig.js](frontend-admin/public/ui/coffee.orig.js) | 385 КБ | `grep -rl "coffee.orig.js" .` → только сам файл |
| D4 | Мёртвый backend-модуль | [backend/src/modules/devices/addons.ts](backend/src/modules/devices/addons.ts) | 65 стр., 5 экспортов | 0 импортов; упоминается только в документации (`ADDONS-DATA-FLOW.md`, `ADDONS-ARCHITECTURE-AUDIT.md`, `REPORT-SAFE-ADDONS.md`) |
| D5 | Нормализация имени в трёх местах | [addonScheme.ts:148](backend/src/modules/catalog/addonScheme.ts#L148), [devices/routes.ts:352](backend/src/modules/devices/routes.ts#L352), [devices/addons.ts:7](backend/src/modules/devices/addons.ts#L7) | 3 копии NFKC + ё→е + пробелы | `grep -rn "normalize('NFKC')" backend/src` |
| D6 | Неиспользуемые компоненты (admin) | [components/SimpleChart.tsx](frontend-admin/src/components/SimpleChart.tsx) (`SimpleLineChart`) | 81 стр. | 0 импортов |
| D7 | Неиспользуемые компоненты (PWA) | [components/ProductThumb.tsx](frontend/src/components/ProductThumb.tsx), [pages/LoginPage.tsx](frontend/src/pages/LoginPage.tsx), `BrandPanelMark` в [BrandLogo.tsx](frontend/src/components/BrandLogo.tsx) | 36 + 6 стр. | 0 импортов, маршрута `/login` нет (redirect на `/`) |
| D8 | ~~Две таблицы схем добавок~~ | `modifier_scheme_items` / `modifier_scheme_options` | — | **закрыто** в `7938d5a`/`7c16e34` (см. §0) |
| D9 | Два парсера каталога в APK | `net/CatalogApi.kt` / `data/CatalogCache.kt` (репо `evotor-app`) | — | расходятся дефолты `maxCount` (2 vs 1) |
| D10 | Словарь групп добавок продублирован в 4 местах | backend [addonScheme.ts:82](backend/src/modules/catalog/addonScheme.ts#L82) (канон `defaultAddonMaxCount`), мёртвый [devices/addons.ts:14](backend/src/modules/devices/addons.ts#L14), [frontend-admin/src/lib/addonScheme.ts:47](frontend-admin/src/lib/addonScheme.ts#L47) (`ADDON_GROUPS_FALLBACK` + `normalizeGroupKey`), APK `MainActivity.kt:1000` (`known` set) | 4 копии | `grep -rn "молоко" backend/src frontend-admin/src` |
| D11 | Дефолт `maxCount` внутри бэкенда расходится | канон [addonScheme.ts:83](backend/src/modules/catalog/addonScheme.ts#L83): `extra→2, остальные→1`; легаси-писатель [addonScheme.ts:720](backend/src/modules/catalog/addonScheme.ts#L720): `milk\|syrup→1, остальные→2` → **sugar получает 2 вместо 1** | 1 строка | `grep -n "maxCount ??" modules/catalog/addonScheme.ts` |

**Дублей роутов нет:** проверено группировкой всех `(метод, путь)` среди `modules/admin/*` и
`modules/staff/*` — совпадений ноль.

---

## 4. Бэкенд готов, клиента нет

Проверено поиском последнего сегмента пути по всему коду клиентов (admin React, статическая
админка, PWA, APK). Достоверность: высокая для уникальных имён (`bank-rows`, `to-invoice`,
`addon-products`), средняя — для общих слов.

| Метод | Путь | Где | Тест есть | Комментарий |
|---|---|---|---|---|
| GET | `/api/admin/addon-products` | [routes.ts:752](backend/src/modules/admin/routes.ts#L752) | нет | ни одного потребителя — решить: UI или удалить |
| POST | `/api/admin/modifiers/backfill-products` | [routes.ts:768](backend/src/modules/admin/routes.ts#L768) | да | разовая операция; достаточно CLI/скрипта |
| POST | `/api/admin/purchases/orders/:id/to-invoice` | [studio.ts:372](backend/src/modules/admin/studio.ts#L372) | да | в статической админке кнопки нет → заказ не превратить в накладную |
| GET/POST/DELETE | `/api/admin/purchases/bank-rows` | [studio.ts:558](backend/src/modules/admin/studio.ts#L558) | да | см. §2.2 |
| PUT | `/api/admin/stock/recipes/:productId` | [studio.ts:619](backend/src/modules/admin/studio.ts#L619) | — | редактирование рецептуры есть только в статической админке |
| POST | `/api/devices/enroll` | [routes.ts:92](backend/src/modules/devices/routes.ts#L92) | да | привязка кассы; в APK не вызывается |
| GET | `/api/devices/whoami` | [routes.ts:163](backend/src/modules/devices/routes.ts#L163) | — | подсказка точки; не вызывается ни APK, ни админкой |

---

## 5. Что есть и работает (инвентарь)

### 5.1. React-админка — 18 разделов

Сегодня · Операции · Клиенты · Карта клиента · Меню (товары / группы / добавки / схемы) ·
Касса (токены Эвотор, сторы, sync, drift, wipe-catalog, push-products) · Маркетинг (акции, ваучеры,
рассылка) · Рефералы · Аналитика · Сравнение периодов · Бизнес-события · Ассистент ·
Система (логи, аудит, метрики, сброс) · Сотрудники (табель, пожелания, привязка устройств) ·
Склад (остатки, сроки, номенклатура, нормы, «без нормы») · Закупки (накладные, поставщики, долги) ·
Инвентаризация · Help

Плюс легаси [AdminPage.tsx](frontend-admin/src/pages/AdminPage.tsx) по адресу `/legacy`.

### 5.2. PWA — 14 экранов

Карта/QR · Меню · Акции · Профиль · Приглашения · Ещё · Legal · О нас · История · Точки ·
Игра Alpaca · Онбординг · Карта-QR · Карточка клиента.
Клиент типизирован через `hc<AppType>` ([frontend/src/api.ts:13](frontend/src/api.ts#L13)) →
расхождений путей с бэкендом структурно быть не может.
Онлайн-оплаты нет **по замыслу**: [ProductSheet.tsx:147](frontend/src/components/menu/ProductSheet.tsx#L147) —
«Заказ и оплата — на кассе».

### 5.3. Касса (репо `evotor-app`, отдельный)

Каталог с группами размеров, добавки по схемам, лояльность, очередь бариста, смена/табель.
Заявленные заглушки: подэкраны `ops/…` в «Смене» (`MainActivity.kt:3039`, `:3929`).

---

## 6. Остаток работ — задачи для агента

Порядок обязателен. Каждая задача — отдельный коммит + проверка.

### T1. Починить «Ваучеры» (P0, 1 строка)
* Файл: [Marketing.tsx:312](frontend-admin/src/pages/Marketing.tsx#L312)
* Замена: `'/vouchers/templates'` → `'/voucher-templates'`
* Приёмка: `npm run build` в `frontend-admin`; вкладка «Ваучеры» открывается без ошибки; в консоли нет 404.
* Не трогать бэкенд.

### T2. Удалить мёртвый код (P2, отдельный коммит)
Удалить: `frontend-admin/public/ui/coffee.orig.js`, `frontend-admin/src/components/SimpleChart.tsx`,
`frontend/src/components/ProductThumb.tsx`, `frontend/src/pages/LoginPage.tsx`,
`backend/src/modules/devices/addons.ts`.
Приёмка: `npm run build` (3/3), `npx tsc --noEmit` в `frontend`, `npx vitest run` в `backend`
(тесты не должны измениться по количеству). Если `devices/addons.ts` используется чем-то, чего
не видит статический анализ — оставить и написать, чем.

### T3. Решение по двум админкам (P1, требует согласования — НЕ делать самому)
Нужно решение владельца: оставить `/` как единственную, или перенести её 5 фич
(`reconciliations`, `purchases/orders` + `order-helper`, `purchases/returns`, `stock/recipes`) в React
и выключить статическую. До решения — ничего не удалять.

### T4. Сверка с банком (P1, после T3)
Экран на существующие роуты §2.2: импорт строк выписки (дата, контрагент, назначение, сумма в
копейках), авто-матч по поставщику и номеру накладной, ручная привязка к накладной, удаление строки.
Приёмка: `POST /purchases/bank-rows` из UI, строка видна после перезагрузки, матч не создаёт дублей.

### T5. Заказ поставщику → накладная (P2)
Кнопка на `POST /purchases/orders/:id/to-invoice` в React-вкладке «Накладные».
Приёмка: после нажатия накладная появляется в списке, заказ помечен как переданный.

### T6. Рецептуры в React (P2)
Редактор на `GET/PUT /stock/recipes/:productId`.
Приёмка: сохранить 18 г кофе для «Капучино» → значение видно после перезагрузки.

### T7. Разобрать «висящие» роуты (P3)
`/admin/addon-products`, `/admin/modifiers/backfill-products`, `/devices/enroll`, `/devices/whoami`:
для каждого — либо UI/вызов, либо удаление. Решение фиксировать в этом файле.

### T8. Свести `maxCount` к одному дефолту (P3, 1 строка)
[addonScheme.ts:720](backend/src/modules/catalog/addonScheme.ts#L720) — заменить инлайн-тернар на
`defaultAddonMaxCount(groupKey)`. Сейчас `sugar` через легаси-путь получает лимит 2 вместо 1.
Приёмка: `npx vitest run` зелёный; тест на сохранение схемы с `sugar` даёт `maxCount = 1`.

---

## 7. Не проверялось

* живые ответы API и прод-база;
* реальный Эвотор (сервис временно недоступен, см. logs-сессию);
* тесты и сборка — не запускались, потому что дерево содержит незакоммиченные правки другой сессии;
* APK — по нему отдельный аудит (`evotor-app`), здесь только пересечение по контракту каталога.

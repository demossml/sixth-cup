# RESEARCH — Аудит лояльности 6.7 (FINAL)

**Дата аудита:** 2026-10-27
**Режим:** read-only. Продуктовый код, тесты, конфиги, миграции и БД не изменялись. Единственный артефакт — этот файл.

| Репо | Путь на машине | HEAD | Ветка |
|---|---|---|---|
| `demossml/sixth-cup` | `~/Downloads/sixth-cup` | `1ca194b05053051ce1bd3312b869cb50000737fe` | `main` |
| `demossml/evotor-app` | `~/Documents/evotor-app` | `216bf8893e0ae17120069e22c860066ffd59b02e` | `main` |

**Легенда:** [Ф] факт кода с `file:line` (проверено на HEAD) · [В] вывод из кода · [Р] рыночная практика · **[RUNTIME]** требует живой БД/устройства.

**Оговорка о HEAD `sixth-cup`.** Пока шёл аудит, владелец закоммитил складские правки: HEAD сдвинулся `b058d4b → 1ca194b`. Дельта (`b058d4b..1ca194b`) — только `backend/src/__tests__/wh-payback-stock.test.ts`, `backend/src/modules/admin/stockWriteOff.ts`, `frontend-admin/src/pages/Inventory.tsx`; ни один файл лояльности не изменился (`stockWriteOff.ts` не содержит обращений к `loyalty_*`, `cashback_*`, `cards`). Все цитаты ниже перепроверены и валидны на `1ca194b`.

**Что заменено.** Предыдущая версия этого файла была собрана против `1ca194b` и APK из tarball `a716881`; она не содержала P0-находки L-00 (см. 0.6) и оценивала L-01 как P0. Настоящая версия — против `1ca194b` + локального `evotor-app @ 216bf88`, с проверкой того, какие каналы реально вызывает касса.

---

## 0. Delta vs FULL

### 0.1 Подтверждено на HEAD (строки уточнены)

| Утверждение FULL | Статус | Доказательство на HEAD |
|---|---|---|
| `SELL` без `extras.sc` не начисляет лояльность, но помечается `PROCESSED` | подтверждено | `integrations/evotor/sync/PollService.ts:155-163` |
| Парсер читает flat / nested / JSON-строку `sc` | подтверждено | `integrations/evotor/loyaltyExtras.ts:8-33` |
| Чашки — по mapped positions + `counts_as_cup`, не по сумме чека | подтверждено | `processing/SellHandler.ts:113-135` |
| Дефолт порога — 5 чашек | подтверждено | `config.ts:28` |
| Ручной код: идентификация без резерва и без списания | подтверждено | `modules/loyalty/reservations.ts:74-76` |
| TTL резерва: дефолт 90 с, эффективный пол `max(30, v)` | подтверждено | `config.ts:31`, `reservations.ts:79` |
| Повтор `doc_id` отсекается до записи балансов | подтверждено, **и это PRIMARY KEY, а не проверка** | `SellHandler.ts:187-188`, `evotor/db.ts:106` |
| `sequenceMatches = true`, `sc.q` не валидируется | подтверждено (строка 208) | `SellHandler.ts:208,244` |
| Referral не ограничен первой покупкой | подтверждено | `SellHandler.ts:229-241`, `devices/sales.ts:82-89`, `loyalty/receipts.ts:83-95` |
| PAYBACK сторнирует referral с полом `MAX(0,…)` | подтверждено | `SellHandler.ts:289-300` |
| Guest history намеренно не использует `loyalty_ledger` | подтверждено | `modules/sync/routes.ts:22-24` |
| Admin disputes — только список последних 100 | подтверждено | `admin/routes.ts:1277-1278` |
| Voucher-выдача без уникальности `(user,template)` | подтверждено | `vouchers/service.ts:8-15` |

### 0.2 Исправлено (FULL был неточен)

| # | Было в FULL | На HEAD |
|---|---|---|
| D-1 | «verify deployed DB indexes separately» про `(doc_store,doc_id)` | Это **`PRIMARY KEY (doc_store, doc_id)`** в DDL таблицы (`evotor/db.ts:92-107`, строка 106), а не индекс из миграции. Дополнительно: у `loyalty_ledger` есть **`UNIQUE (source_type, source_id, card_id, operation)`** (`evotor/db.ts:119`) — в FULL этого не было, а это защита от дублей ledger. |
| D-2 | L-14: «текст "каждый шестой" расходится с `CUPS_FOR_FREE=5`» | **Расхождения нет.** `freeEarned = floor(paid/5)` → после 5 оплаченных 6-я чашка бесплатна, и «каждый шестой» — верная формулировка для дефолта. Реальный дефект другой: число **захардкожено** в четырёх местах при конфигурируемом пороге (L-14′). Severity P1 → P2. |
| D-3 | L-11 «APK не аудирован» | **Снято**: APK доступен (`evotor-app @ 216bf88`) и аудирован. Взамен — L-00 (P0), L-20, L-21. |
| D-4 | L-09 «WELCOME conditional» | Больше не conditional: оба места выдачи WELCOME лежат в каналах, **которые APK не вызывает** (см. 0.5) → WELCOME сейчас не выдаётся вообще. |
| D-5 | L-07 «verify poll retries» | Проверено: **ретрая нет** (0.3). |
| D-6 | «`.env.example` не найден в архиве» | Подтверждено на HEAD: файла нет нигде в репо. |
| D-7 | Строки `SellHandler` 192-208 / 242-245 / 251-259 | Актуально: `205` — потребление резерва, `208` — `sequenceMatches`, `244` — dispute о клэмпе, `258` — `base SELL not found`, `289-300` — referral-сторно. |

### 0.3 Закрыто: было [НЕТ ДАННЫХ] → известно из кода

| Вопрос FULL | Ответ на HEAD |
|---|---|
| **Какие каналы смонтированы в bootstrap?** | Все три смонтированы **безусловно** (`app.ts:145-158`): `/api/sync` (history + receipts), `/api/devices` (resolve, `POST /sales`). Evotor-poll стартует отдельно и только при `EVOTOR_API_TOKEN` или сохранённом токене (`index.ts:21`), плюс требует `evotor_stores.sync_enabled=1` (`PollService.ts:16,242-246`). |
| **Есть ли ручная корректировка баланса (admin ±)?** | **Нет.** `ADJUSTMENT` объявлен в `CHECK (operation IN ('EARN','SPEND','REVERSAL','ADJUSTMENT'))` (`evotor/db.ts:112`), но **ни одна строка кода его не пишет**. Ручного ± cashback нет ни в `admin/routes.ts`, ни в `admin/console.ts`. |
| **Индексы/уникальность** | `loyalty_ops` — PK `(doc_store,doc_id)`; `loyalty_ledger` — UNIQUE `(source_type,source_id,card_id,operation)`; `loyalty_reservations` — частичный unique `card_id WHERE status='RESERVED'` (`011_loyalty_reservations.sql:17`); `users.card_id` / `users.card_code` — unique (`005:5`, `008:10`); `receipts.id` — PK (`schema.ts:66`); `vouchers` — только индекс `user_id` (`schema.ts:46`), уникальности `(user,template)` **нет**. |
| **Где выдаётся WELCOME** | 5 call sites: `loyalty/receipts.ts:51-57` (receipt-sync, первая оплата), `devices/sales.ts:90-92` (online-sale), `admin/console.ts:404-413` (вручную клиенту), `admin/routes.ts:1272` (bulk по всем), `db/seed.ts:154` (демо). В `SellHandler` — **нет**. |
| **Текст «каждый шестой»** | 4 независимых места: `public/routes.ts:14` (fallback, переопределяется `app_settings.legal_loyalty`), `frontend/src/copy/ru.ts:38` (дубль), `InvitePage.tsx:19,74`, `db/seed.ts:90` (промо «Каждый 6-й стакан бесплатно»). Прогресс карты считает от серверного `cupsForFree` (`CardPage.tsx:35`, `plural.ts:16-21`) — там текст адаптивный. |
| **Что конфигурируется env** | env: `CUPS_FOR_FREE`, `CARD_QR_TTL_SEC`, `RESERVATION_TTL_SEC`, `EVOTOR_*`, `PUSH_ENABLED`. Хардкод: `referralCashbackPercent = 3`, `maxVouchersInCard = 5`. Таблица — раздел 3. |
| **Кто реально вызывает каналы записи** | APK вызывает только `/api/devices/whoami`, `/api/devices/loyalty/resolve`, `/api/devices/catalog`, `/api/devices/logs`. **`POST /api/devices/sales` и `POST /api/sync` касса не вызывает**; PWA читает только `GET /api/sync/history`. Значит единственный живой путь записи лояльности — **Evotor poll**. |

### 0.4 Усилено

| # | Было | Стало |
|---|---|---|
| L-02 | «разные ключи дедупа, пересечение не доказано» | Плюс доказано, что дедуп между online-sale и receipt-sync **невозможен по построению**: оба пишут в `receipts`, но online — ключ `` `${deviceId}:${fiscalId}` `` (`sales.ts:36`), receipt-sync требует `r.r` формата `` `${deviceId}-…` `` (`receipts.ts:114`). Разные пространства ключей в одной таблице → один чек, отправленный двумя путями, учтётся дважды. **Но:** ни один известный клиент этих путей не вызывает (0.3), поэтому практическая severity понижена (см. раздел 13). |
| L-07 | «verify poll retries» | **Ретрая нет.** Документ вставляется `INSERT OR IGNORE` и обрабатывается только при `r.changes > 0` (`PollService.ts:195-226`); при `FAILED` строка уже существует → повторный поллинг её не переобработает. Ни один эндпоинт не переобрабатывает `FAILED` (`admin/console.ts` только считает). То же для упавшего в исключении SELL (`PollService.ts:173-177`). |
| L-10 | «нет уникальности» | Плюс: bulk-выдача по всем пользователям идемпотентностью не обладает (`admin/routes.ts:1267-1274`). |

### 0.5 Снято / понижено

| # | Было | Стало |
|---|---|---|
| L-11 | P2 «APK не подтверждён» | **Снято** — APK аудирован. |
| L-14 | P1 «копирайт противоречит конфигу» | **P2**, переформулировано (D-2, L-14′). |
| «flat vs nested `extras.sc` — риск двойного применения» | — | **Снято.** APK пишет оба ключа с идентичным содержимым (`CardSession.kt:73-80`), парсер берёт первый найденный (`loyaltyExtras.ts:11`), документ один → двойного применения быть не может. |
| L-02 | P1 / P0 candidate | **P2 + [RUNTIME]**: архитектурная дыра подтверждена, но оба «опасных» эндпоинта никем не вызываются. Реальная severity зависит от того, появится ли клиент. |

### 0.6 Новое, чего не было в FULL

- **L-00 (P0):** APK отправляет в `extras.sc.c` **числовой код карты** вместо подписанного QR-токена → backend никогда не списывает подарок и кэшбэк в Evotor-канале, хотя скидка на кассе уже дана. Регрессия внесена коммитом `57a5c5f` (evotor-app, 2026-10-25, versionCode 114).
- **N-01:** APK вообще не отправляет `sc.q` → `sequenceMatches = true` не «дыра», а следствие того, что проверять нечего (переосмысление L-04).
- **L-16:** `pushEnabled` в `/api/public/content` всегда `false` — читается из `config`, а флаг лежит в `evotorConfig`.
- **L-17:** `ANDROID_INTEGRATION_CONTRACT.md:79-83` утверждает, что APK проверяет Ed25519-подпись QR; в APK нет ни крипто-кода, ни публичного ключа — проверяет только сервер.
- **L-18:** админ-статистика рефералов считает «купил» только по `loyalty_ops` (Evotor), поэтому покупки через другие каналы не видны.
- **L-19:** `friendsView` показывает нетто (с минусами), история — только положительные строки; после возврата суммы на экранах не сходятся.
- **L-20:** `free_cup_overdraw` в receipt-sync — только dispute после факта, без клэмпа.
- **L-21:** `503 proxy_not_configured` кассир видит как «сервер недоступен» — нет отдельного сообщения о настройке.

---

## 1. Executive summary

1. **[P0] Подарок и кэшбэк в Evotor-канале не списываются.** APK кладёт в `extras.sc.c` числовой `cardCode` (`CardSession.kt:84-87`), backend считает такой код «ручным» и не вызывает `consumeReservation` (`SellHandler.ts:205`). Касса при этом скидку применяет — она выдаётся по наличию резерва (`DiscountCalc.kt:17-18,34-37`). Итог: `cards.free_used` и `users.cashback_balance` не меняются, `loyalty_ops.free/cb = 0`, резерв остаётся `RESERVED` и переиспользуется. Первопричина — регрессия `57a5c5f` в `evotor-app` (до него отправлялся `info.code`, т.е. токен).
2. **[В] Это единственный живой путь.** `POST /api/devices/sales` и `POST /api/sync` касса не вызывает, PWA только читает историю → все остальные каналы записи сейчас не работают, а значит L-00 бьёт по 100% продаж с картой.
3. **[P1] Ретрая нет:** `PAYBACK` без базового `SELL` (и любой упавший документ) помечается `FAILED` и никогда не переобрабатывается → возврат не сторнирует чашки/кэшбэк/реферальный бонус, видно только счётчиком в админке.
4. **[P1] WELCOME не выдаётся:** оба места выдачи — в каналах, которые касса не вызывает. Обещанный «скидка 10% на первую покупку» ваучер в реальности не появляется.
5. **[P1] Referral-начисления не ограничены первой покупкой**, при возврате сторнируются с полом баланса `MAX(0,…)`, но в ledger пишется полная отрицательная сумма → ledger и баланс расходятся на уже потраченный бонус (accounting, не double-spend).
6. **[P1] Чашки считаются по-разному в каналах:** Evotor — по uuid-мэппингу + `counts_as_cup`; online-sale — по `productId`, иначе по regex названия → один товар может дать разный результат.
7. **[P1] `receipt-sync` применяет дельты частично** (баланс не изменён, ledger и `cards` изменены) и **не атомарен по ваучеру** (проверка `used_at` и `UPDATE` без условия).
8. **[P1] Guest history бедна:** нет причин отказа, списаний кэшбэка, отрицательных referral-строк, жизненного цикла ваучеров.
9. **[P2]** Хардкод «6» и «3%» при конфигурируемых значениях; `pushEnabled` всегда `false`; контракт обещает проверку подписи в APK, которой нет; админ-статистика рефералов не видит не-Evotor каналы; disputes без workflow; у кэшбэка нет модели сроков.
10. **[В]** Концепция «карта/QR ↔ касса ↔ backend ↔ PWA», чашки, кэшбэк, реферал и ваучеры сохраняется. Менять экономику (порог, %, TTL, expiry, tiers) сейчас не нужно — сначала L-00 и наблюдаемость.

---

## 2. Domain model

| Сущность | Хранит | Кто пишет | Кто читает | Идемпотентность |
|---|---|---|---|---|
| `users` (`schema.ts:2-10` + `005:3-5`, `008:3-10`) | `id`, `card_id` (opaque, unique), `card_code` (цифры, unique), `invite_code`, `invited_by`, `cashback_balance` (копейки) | auth/регистрация, game, каналы продаж | все чтения, PWA, admin | card_code — идентификатор, **не** credential для списания |
| `cards` (`schema.ts:18-24`) | `paid_total`, `free_used`, `seq`, `updated_at` | Evotor SELL/PAYBACK, online-sale, receipt-sync | `stateView`, `resolve`, admin | агрегат; `freeEarned = floor(paid_total / cupsForFree)` |
| `loyalty_ops` (`evotor/db.ts:92-107`) | документ Эвотора (`doc_store`,`doc_id`), `kind`, `card_id`, `op_claimed`, `q_claimed`, `free`, `cb`, `result_rub`, `cups_counted` | только `SellHandler` | дедуп, PAYBACK, история, аналитика | **PK `(doc_store,doc_id)`** (стр. 106) |
| `loyalty_ledger` (`evotor/db.ts:109-120`) | `operation` EARN/SPEND/REVERSAL/ADJUSTMENT, дельты, `source_type`, `source_id` | Evotor, online-sale, receipt-sync, game | admin, аналитика (**не** guest history) | **UNIQUE `(source_type,source_id,card_id,operation)`** (стр. 119); `ADJUSTMENT` объявлен, но не пишется никем |
| `cashback_ledger` (`schema.ts:78-86`) | `beneficiary_id`, `from_user_id`, `receipt_id`, `amount` (в т.ч. отрицательные) | referral в 3 каналах, game, PAYBACK | `friendsView`, история (`amount>0`), admin | нет универсального уникального ключа |
| `loyalty_reservations` (`011:1-18`) | `id`, `card_id`, `benefit_free`, `benefit_cb`, `store/device`, `status`, `expires_at`, `doc_*` | `resolveAndReserve` | `consumeReservation`, TTL-экспирация | unique `card_id WHERE status='RESERVED'` (`011:17`); потребление — условный UPDATE + `changes===1` (`reservations.ts:113-115`) |
| `receipts` (`schema.ts:65-76`) | `id` (PK), device/user, `dp/df/dcb`, `amount`, `ts`, `raw` | online-sale (`d:фiscalId`), receipt-sync (`d-…`) | дедуп обоих каналов | PK по `id`; **разные пространства ключей** |
| `voucher_templates` / `vouchers` (`schema.ts:26-46`) | шаблон; экземпляр `user/template/expires_day/used_at/receipt_id` | seed, admin, `grantVoucher`, receipt-sync | `activeVouchers`, receipt-sync | уникальности `(user_id,template_id)` нет |
| `disputes` (`schema.ts:88-95`) | `kind`, `user_id`, `receipt_id`, `details`, `created_at` | loyalty-обработчики, склад | admin GET (100 последних) | append-only, без статусов |
| `card_denylist` (`evotor/db.ts:122-127`) | `card_id`, `reason`, `released_at` | админ/вручную | `resolveAndReserve` | блокировка карты |

**Правила баланса** (`modules/loyalty/rules.ts:3-5`):

- `freeEarned(paidTotal) = floor(paidTotal / config.cupsForFree)`
- `cashbackOf(amount) = floor(amount * config.referralCashbackPercent / 100)`
- прогресс гостя `= paid_total % cupsForFree`; доступно подарков `= max(0, freeEarned − free_used)` (`cardLookup.ts:25-27`)

[В] `counts_as_cup` (прогресс чашек, миграция `004:1`) и `free_eligible` (какие позиции можно взять подарком, `005:10`) — **разные** поля. Их смешение в админке — отдельный риск (L-13).

---

## 3. Config: код-дефолты и имена env

| Параметр | Env | Дефолт кода | Где используется | Прод |
|---|---|---|---|---|
| `cupsForFree` | `CUPS_FOR_FREE` | **5** (`config.ts:28`) | `rules.ts:3`; `cardLookup.ts:25,52`; `reservations.ts:69-70`; `sales.ts:69`; `directory/routes.ts:155` | [RUNTIME] |
| `cardQrTtlSec` | `CARD_QR_TTL_SEC` | **30 суток** (`config.ts:29`) | TTL подписанной карты | [RUNTIME] |
| `reservationTtlSec` | `RESERVATION_TTL_SEC` | **90 с** (`config.ts:31`), эффективно `max(30, v)` (`reservations.ts:79`) | резерв на кассе | [RUNTIME] |
| `referralCashbackPercent` | **нет env** | **3** (`config.ts:32`) | `rules.ts:5`; `directory/routes.ts:156`; `InvitePage.tsx:12` | меняется только кодом |
| `maxVouchersInCard` | **нет env** | **5** (`config.ts:34`) | лимит показа `vouchers/service.ts:22` | меняется только кодом |
| WELCOME-шаблон | — | seed `percent 10 / 30 дней` (`seed.ts:77-82`) | `grantVoucher(…,'WELCOME')` | [RUNTIME] — строку в БД могли править |
| `evotorConfig.appId` | `EVOTOR_APP_ID` | `151071e8-88a4-44f6-b71a-b17c559f9b7d` (`config.ts:59`) | `extractScRaw` (nested `extras[appId].sc`) | [RUNTIME] — совпадает ли с `BuildConfig.APP_UUID` APK |
| `evotorConfig.enabled` | `EVOTOR_API_TOKEN` непустой | `false` (`config.ts:64`) | запуск PollService (`index.ts:21`) | [RUNTIME] |
| `pushExtras` | `EVOTOR_PUSH_EXTRAS === '1'` | `false` (`config.ts:60`) | доставка extras | [RUNTIME] |
| `pushEnabled` | `PUSH_ENABLED === '1'` | `false` (`config.ts:61`) | **не отдаётся**: публичный роут читает `config.pushEnabled`, которого нет (L-16) | — |
| `evotorProxyEnforce` | `EVOTOR_PROXY_ENFORCE === '1'` | `false` (`config.ts:40`) | `/api/devices/*` | [RUNTIME] |
| `evotorProxyToken` | `EVOTOR_PROXY_TOKEN` | `''` (`config.ts:38`) | `resolve` требует непустой (`devices/routes.ts:46`) | [RUNTIME] |

[В] Дефолты ≠ прод. Но: порог и TTL **уже** конфигурируемы env, а процент реферала и лимит ваучеров — нет. Любая публичная формулировка «1 из N» и «X%» должна браться из `/api/directory` / состояния карты, а не хардкодиться.

---

## 4. Channel matrix + bootstrap

### 4.1 Что реально смонтировано

`app.ts:145-158` монтирует **безусловно**: `/api/auth`, `/api/loyalty`, `/api/directory`, `/api/sync`, `/api/devices` (два роутера), `/api/dev`, `/api/client-logs`, `/api/admin`, `/api/admin/upload`, `/api/game`, `/api/game/runner`, `/api/public`, `/api/analytics`.

Отдельно, `index.ts`:

- `if (evotorConfig.enabled || anyTokenConfigured(db))` → создаётся `PollService`, тик каждые `max(15, EVOTOR_POLL_INTERVAL_SEC)` секунд (`index.ts:21-84`), плюс часовой и дневной прогон (`index.ts:71-86`).
- `runFast` дополнительно требует хотя бы одну точку с `sync_enabled=1` (`PollService.ts:242-246`), иначе лог `evotor poll skipped — no stores`.

**Кто из клиентов что вызывает:**

| Клиент | Фактические вызовы |
|---|---|
| APK `evotor-app @ 216bf88` | `GET /api/devices/whoami`, `POST /api/devices/loyalty/resolve`, `GET /api/devices/catalog`, `POST /api/devices/logs` |
| PWA `frontend/` | `GET /api/sync/history`, `/api/directory`, `/api/loyalty/card`, auth |
| Сторонних клиентов для `POST /api/devices/sales` и `POST /api/sync` в репозиториях **нет** |

[В] Значит запись лояльности сегодня идёт **только** через Evotor-poll (при настроенном токене), а online-sale и receipt-sync — «спящие» эндпоинты, готовые к подключению.

### 4.2 Матрица

| Канал | Вход | Auth | Ключ дедупа | Чашки | Referral | WELCOME | Списание подарка/кэшбэка | Используется? |
|---|---|---|---|---|---|---|---|---|
| **Evotor poll** | `PollService` → `handleSell`/`handlePayback` (`PollService.ts:119-178`) | токен Эвотора + `sync_enabled=1` | `loyalty_ops` **PK** `(doc_store,doc_id)` | uuid-мэппинг + `counts_as_cup` × `floor(qty)` (`SellHandler.ts:113-135`) | % от `amount − appliedCb`, без гейта (`:229-241`) | **нет** | **только при `c` = подписанный токен** (`:205`) → на практике не срабатывает (L-00) | да, при токене |
| **Online sale** | `POST /api/devices/sales` (`devices/routes.ts:545-561` → `sales.ts:31-107`) | `requireDevice` | `receipts.id = "<deviceId>:<fiscalId>"` (`sales.ts:36`) | `productId → counts_as_cup`, иначе regex по имени (`:53-66`) | % от `amount − cashbackUse` (`:82-89`) | при первой оплате (`:90-92`) | `useFree`/`cashbackUseRub` **из запроса**, без резерва (`:68-74`) | клиента нет |
| **Signed receipt-sync** | `POST /api/sync` (`sync/routes.ts:49-58` → `receipts.ts:98-131`) | `requireAuth` + подпись устройства | PK `receipts.id = r.r`, формат `"<deviceId>-…"` (`:114`) | клиентские дельты `dp/df` (`:42-44`) | % от `r.a` (`:83-95`) | при первой оплате (`:51-57`) | `dcb` → баланс (`:59-68`), `vu` → ваучеры (`:70-76`) | клиента нет |
| **Game** | `/api/game` | `requireAuth` | `game_daily` + `client_nonce` | — | — | — | только начисление, ≤1 приз/UTC-день | да |
| **Admin voucher** | `POST /admin/customers/:id/vouchers`, bulk | admin-токен | **нет** | — | — | может выдать | — | да |
| **Admin ± cashback** | — | — | — | — | — | — | **отсутствует** | — |

### 4.3 Почему каналы не могут дедуплицировать друг друга

- Evotor пишет `loyalty_ops` (ключ: store+doc Эвотора).
- Online-sale пишет `receipts` с ключом `` `${deviceId}:${fiscalId}` `` (`sales.ts:36`).
- Receipt-sync пишет `receipts` с ключом `r.r`, обязанный начинаться с `` `${r.d}-` `` (`receipts.ts:114`).

Два «receipt»-канала живут в одной таблице, но **форматы ключей не пересекаются** (`:` vs `-`), поэтому один физический чек, отправленный по обоим путям, создаст две строки и применит дельты дважды. Канонического fiscal-id и таблицы соответствия каналов в коде нет.

[В] Архитектурная дыра подтверждена; severity ограничена тем, что оба эндпоинта пока не вызываются ни одним клиентом (см. раздел 13).

---

## 5. Accrual

### 5.1 Evotor SELL (`SellHandler.ts:140-249`)

1. Нет `doc_id` → `processed:false` (`:141-142`). Нет `sc` → `processed:false, 'no loyalty extra'` (`:143-144`), но `PollService` до этого отсеивает такие документы через `hasLoyaltySc` и ставит `PROCESSED` (`PollService.ts:155-163`).
2. `getSc` принимает `extras.sc` / `extras[appId].sc` / JSON-строку, требует `v ≥ 2` и строковый `c` (`:106-111`).
3. Ветвление по `c`:
   - есть `.` → подписанный токен: `verifyServerToken`, `t='c'`, `ver=2`, поиск по `card_id` (`:150-163`);
   - иначе → цифровой код: `normalizeCardCode`, поиск по `card_code` с нормализацией ведущих нулей (`:164-183`).
4. Дедуп `(store,doc)` — `:187-188` (PK защищает и при гонке).
5. `cups = cupsForDocument(...)`: только `REGISTER_POSITION`/`POSITION`, мэппинг `evotor_products` → `product_store_links`, `cups += floor(qty)` при `counts_as_cup` (`:113-135`).
6. Клэмпы: `appliedFree = min(reserved.free, claimedFree, freeAvail, cups)`; `appliedCb = min(reserved.cb, claimedCb, balance, amount)` (`:206-207`), где `reserved` — **только** для токена (`:205`).
7. Транзакция: `loyalty_ops` insert, `cards` (`paid_total += cups − appliedFree`, `free_used += appliedFree`, `seq+1`), `users.cashback_balance −= appliedCb`, `loyalty_ledger` EARN, referral, dispute при клэмпе (`:214-246`).

### 5.2 Online sale (`sales.ts:31-107`)

Дедуп по `fiscalKey` (`:36-47`) → `cards`, списание кэшбэка, referral, WELCOME, `receipts`, `loyalty_ledger` — одна транзакция (`:77-97`). Чашки: `productId → counts_as_cup`, иначе эвристика по имени (regex «латте|капуч|американо|раф|эспрессо|флэт|…», `:60-64`) и `Math.max(1, qty)` (`:65`). Подарок и кэшбэк принимаются из запроса с клэмпом по состоянию, но **без резерва** (`:68-74`) — доверие авторизованному устройству.

### 5.3 Receipt-sync (`receipts.ts:98-131`)

Подпись Ed25519 по `devices.public_key`, отзыв устройства, формат `r.r`, `ts ≤ now+24ч`, существование пользователя (`:104-115`); sequence `r.q > cards.seq`, иначе dispute `stale_receipt_sequence` (`:116-121`); `INSERT OR IGNORE receipts` → дубль (`:123-126`); затем `applyOne` (`:38-96`): `cards += dp/df`, `loyalty_ledger` EARN с `cashback_delta = −dcb`, WELCOME при первой оплате, списание кэшбэка с dispute при нехватке, ваучеры, проверка `free_cup_overdraw`, referral.

### 5.4 Game

Начисление cashback за достигнутый уровень, ≤1 приз на UTC-день (`game_daily` + `client_nonce`, `game/routes.ts:126-172`). Чашек не даёт.

---

## 6. Redemption

### 6.1 Задуманный контур

1. Гость показывает QR → APK `POST /api/devices/loyalty/resolve` (`devices/routes.ts:41-72`).
2. `resolveAndReserve` (`reservations.ts:54-101`): токен → резерв `RESERVED` (`free = freeAvailable>0 ? 1 : 0`, `cb = весь баланс`), TTL `max(30, config)`. Другой терминал при живом резерве получает `ALREADY_RESERVED` и нули (`:92`); тот же терминал продлевает свой резерв (`:88-91`).
3. Ручной цифровой код → `kind='code'`, `freeAvailable:0`, `cashback:0`, `reservationId:null` (`:74-76`).
4. Касса даёт скидку **только при живом резерве** (`DiscountCalc.kt:17-18,34-37`), лист «Лояльность» открывается только при `reserved && (giftPossible || cbPossible)` (`MainActivity.kt:2840-2847`).
5. Backend потребляет резерв условным UPDATE (`reservations.ts:108-118`), `changes===1` гарантирует однократность.

### 6.2 Что происходит на HEAD фактически (L-00)

```
APK:  resolve → cardCode = "0012", reservationId = "R-…"
      CardSession.sc():   c    = "0012"      (CardSession.kt:84,87)
                          op   = "R-…"       (:90)
                          kind = "token"     (:89)   ← backend kind не читает
Backend: getSc → c = "0012"                  (SellHandler.ts:109)
         rawCard.includes('.') === false     (:150)
         isToken = false                     (:204)
         reserved = { free: 0, cb: 0 }       (:205)
         appliedFree = 0, appliedCb = 0      (:206-207)
```

Последствия:

- `cards.free_used` **не растёт** → `freeAvailable` не уменьшается → подарок можно брать повторно;
- `users.cashback_balance` **не уменьшается** → кэшбэк тратится многократно;
- резерв остаётся `RESERVED` до TTL, затем `EXPIRED` (и `EXPIRED` тоже был бы потреблён, если бы `consumeReservation` вызвали);
- `loyalty_ops.free/cb = 0` → в учёте «льгот не выдавали», хотя POS уменьшил сумму чека.

**Первопричина** — регрессия в APK: до `57a5c5f` было `put("c", info.code)` (сырое значение; для QR — подписанный токен), после — `cardCode.ifBlank { code }`. Тот же коммит добавил `kind`, который сервер не читает, поэтому «token» в чеке ни на что не влияет.

[В] Этот же дефект объясняет «фантомные» `ALREADY_RESERVED`: резервы почти никогда не потребляются.

---

## 7. Vouchers

| Аспект | Факт |
|---|---|
| Шаблоны | `voucher_templates(code UNIQUE, kind, value, valid_days)` (`schema.ts:26-33`); WELCOME = `percent 10 / 30 дней` (`seed.ts:77-82`) |
| Выдача | `grantVoucher(userId, code)` — `INSERT` без проверки дубля (`vouchers/service.ts:8-15`) |
| Кто выдаёт | receipt-sync при первой оплате (`receipts.ts:51-57`), online-sale (`sales.ts:90-92`), админ вручную (`console.ts:404-413`), bulk по всем (`admin/routes.ts:1267-1274`), демо-сид (`seed.ts:154`) |
| Показ гостю | `activeVouchers`: неиспользованные и не истёкшие, лимит `maxVouchersInCard` (`service.ts:17-25`) |
| Погашение | только receipt-sync, массив `vu` (`receipts.ts:70-76`) |
| Идемпотентность погашения | проверка `used_at` → `UPDATE` **без** `used_at IS NULL`; `changes` не проверяется |
| Evotor-канал | ваучеры **не** выдаются и **не** погашаются |

[В] Пока погашение идёт только через receipt-sync и весь цикл внутри одной транзакции (`receipts.ts:98`), гонка требует двух процессов. Но и выдачи нет: оба места WELCOME — в неиспользуемых каналах (L-09).

---

## 8. Referrals

- Процент: `cashbackOf` (`rules.ts:5`), база — сумма минус списанный кэшбэк: `SellHandler.ts:230`, `sales.ts:81-83`, `receipts.ts:83-86` (там база `r.a`).
- **Гейта «только первая покупка» нет** ни в одном канале: бонус начисляется на каждую покупку приглашённого.
- Сторно: PAYBACK берёт положительные строки `cashback_ledger` по `receipt_id = baseId` (`:289`), уменьшает баланс с полом `MAX(0,…)` (`:293`), но пишет в ledger **полную** отрицательную сумму (`:295-300`) → баланс и ledger расходятся на уже потраченный бонус (L-01).
- Отображение: `friendsView` — нетто (`cardLookup.ts:33-35`), guest history — только `amount>0` (`sync/routes.ts:34-36`) → суммы не сходятся после возврата (L-19).
- Админ-статистика: `withPurchase` / `bought` считаются только по `loyalty_ops` (`admin/routes.ts:1111-1113`, `studio.ts:1159`) → покупки через другие каналы не видны (L-18).

---

## 9. Admin & disputes

| Функция | На HEAD | Файл |
|---|---|---|
| Список споров | `GET /admin/disputes` — 100 последних, без статусов и оператора | `admin/routes.ts:1277-1278` |
| Счётчики ошибок | `evotor_docs.status='FAILED'` по точкам и по дням | `admin/console.ts:50,90,175-197` |
| Переобработка `FAILED` | **отсутствует** | — |
| Ручная корректировка cashback | **отсутствует** (`ADJUSTMENT` не пишется) | `evotor/db.ts:112` |
| Выдача ваучера клиенту | есть, с audit-записью | `admin/console.ts:404-413` |
| Bulk-выдача ваучера | есть, **без проверки дублей** | `admin/routes.ts:1267-1274` |
| Сводка рефералов | `referrerCard`, `invited`, `withPurchase`, `cashbackKop` | `admin/routes.ts:1107-1121` |
| Пары рефералов | `from/to`, дата, `bought`, `bonusKop` | `studio.ts:1155-1165` |

[В] Для разбора инцидентов есть: список споров, счётчики `FAILED`, `last_error`. Нет: причины конкретного начисления, ручной корректировки, переобработки документа. Это минимальный набор для пилота.

---

## 10. E2E-сценарии (проверено на HEAD)

### 10.1 QR + подарок (основной путь)

| Шаг | Что происходит |
|---|---|
| 1 | `paid_total = 5`, скан QR → `resolve` создаёт резерв `free=1`, `cb=<баланс>`, `reservationId=R-…` (`reservations.ts:94-99`) |
| 2 | Касса показывает подарок; `DiscountCalc.reserved()=true` → скидка применена (`DiscountCalc.kt:17,34`) |
| 3 | APK пишет `sc = { v:2, c:"0012", op:"R-…", free:1, cb:0, kind:"token" }` (`CardSession.kt:83-93`) |
| 4 | `handleSell`: `c` без точки → **числовая** ветка (`SellHandler.ts:164-183`) |
| 5 | `consumeReservation` **не вызывается** (`:205`) → `appliedFree = 0` (`:206`) |
| 6 | `loyalty_ops.free = 0`; `cards.free_used` не изменён; `cards.paid_total += cups` |
| 7 | Резерв остаётся `RESERVED`: тот же терминал продлевает (`:88-91`), другой получает `ALREADY_RESERVED` (`:92`) |

**Итог:** подарок выдан деньгами и не списан с баланса гостя. Повторяемо на одном терминале без ограничений. **L-00.**

### 10.2 QR + кэшбэк

Аналогично: `appliedCb = 0`, `users.cashback_balance` не уменьшается, `benefit_cb` не потреблён. Кэшбэк можно тратить повторно.

### 10.3 Повторный `doc_id`

Второй `SELL` с тем же `(store,doc)` → `existing` (`SellHandler.ts:187-188`) → `processed:true, reason:'duplicate'`; балансы не тронуты, повторной строки в `loyalty_ops` не будет (PK), `loyalty_ledger` защищён своим UNIQUE.

### 10.4 SELL без `extras.sc`

`processLoyalty` → `hasSc=false` → `evotor_docs.status='PROCESSED'`, лог `skip no loyalty extra` (`PollService.ts:157-163`). Чашки не начислены; склад обрабатывается отдельно (`processDocument` вызывает `processStock` независимо, `:119-124`). Восстановления нет — документ не вернётся.

### 10.5 Ручной код

`resolve` → `kind='code'`, `freeAvailable:0`, `cashback:0`, `reservationId:null` (`reservations.ts:74-76`). Касса подарок не предложит (`DiscountCalc.reserved=false`). Начисление чашек при SELL сработает. [Ф] `reservations.test.ts:94-101`.

### 10.6 `ALREADY_RESERVED` / истёкший резерв

Терминал A держит резерв; B получает `ALREADY_RESERVED` и нули; A при повторном скане продлевает; после TTL создаётся новый, старый `EXPIRED`. Поздний чек может потребовать `EXPIRED`, но только один раз — условный UPDATE + `changes===1` (`reservations.ts:113-115`). [Ф] `reservations.test.ts:55-92`.

[В] При L-00 резервы не потребляются, поэтому `ALREADY_RESERVED` возникает чаще задуманного.

### 10.7 PAYBACK 50% / 100%

1. Исходный `SELL` есть в `loyalty_ops`.
2. Доли считаются от `result_rub` и уже сторнированных PAYBACK (`:279-288`), `full` при `cumFrac ≥ 0.999999`.
3. Чашки/подарок/кэшбэк возвращаются как `max(0, доля − уже возвращено)` (`:291-293`).
4. Referral-сторно — по строкам `cashback_ledger` исходного чека, пропорционально `fracDelta`, баланс с полом 0, ledger — полная отрицательная сумма (`:289-300`) → расхождение (L-01).
5. **Если базового `SELL` ещё нет** → `processed:false, 'base SELL not found'` (`:258`) → документ `FAILED` и **никогда не переобрабатывается** (L-07).

### 10.8 Один чек через два канала

Online-sale и receipt-sync пишут в `receipts` с непересекающимися форматами ключей; Evotor — в `loyalty_ops`. Общего ключа нет → один чек, отправленный дважды, применит дельты дважды. [RUNTIME] — пока ни один клиент так не делает.

---

## 11. APK / cashier (аудировано на `216bf88`)

| Аспект | Факт |
|---|---|
| Форма extras | `{ "<BuildConfig.APP_UUID>": { "sc": … }, "sc": … }`, значения идентичны (`CardSession.kt:73-80`); backend берёт плоский `sc` первым (`loyaltyExtras.ts:11`), затем `extras[appId].sc`, затем любой объект со `sc` (`:22-27`) |
| Поля `sc` | `v=2`, `c = cardCode.ifBlank{code}`, `ts` (мс), `kind = token|code`, `op` при наличии, `free` 0/1, `cb` в **копейках** (`CardSession.kt:83-93`) |
| **`c` при онлайн-QR** | **числовой `cardCode`** — расходится с `ANDROID_INTEGRATION_CONTRACT.md:83` и с контрактом списания → **L-00** |
| `sc.q` | **не отправляется** (N-01) → `sequenceMatches = true` нечего проверять |
| `kind` | backend не читает |
| Проверка подписи QR в APK | **отсутствует**: нет крипто-кода и публичного ключа в `BuildConfig`; APK шлёт сырое значение, проверяет сервер → L-17 (расход с документом контракта) |
| Ручной код vs QR | различаются только `kindOf(code)` и наличием `reservationId`; списание включается лишь по `reservationId != null` (`DiscountCalc.kt:17`) |
| Офлайн | `cardCode=""`, `code` — токен (если QR) → `sc.c` = токен → backend начислит чашки, льгот не даст (`LoyaltyApi.kt:68-75`) |
| TTL сессии карты | 10 минут в `SharedPreferences`, затем очистка (`CardSession.kt:33,45-48`) |
| Ошибки resolve | 400/404 → карта не прикрепляется; 401/403 и 5xx → карта снимается, нотис кассиру; таймауты 4/6 с (`LoyaltyApi.kt:44-65`) |
| Клэмп кэшбэка | `min(requested, balance)`, только при живом резерве (`DiscountCalc.kt:36-37`) |
| Лист «Лояльность» | открывается только при `reserved && (giftPossible || cbPossible)` (`MainActivity.kt:2840-2847`); переключатели «Подарок»/«Кэшбэк» раздельные (`:2934-2936`), кэшбэк уходит как `card.cashbackKopecks` целиком |
| Тесты extras | `CardSessionExtrasTest.kt:30-56` закрепляют «`c = cardCode`» и «токен только если `cardCode` пуст» — поведение осознанное, но несовместимое с backend |
| Каналы записи | APK вызывает только `whoami`, `resolve`, `catalog`, `logs` — `/sales` и `/sync` не вызывает |

---

## 12. PWA transparency

**Что видит гость**

- История (`sync/routes.ts:25-48` → `HistoryPage.tsx:107`): `SELL` → «Покупка», `PAYBACK` → «Возврат покупки», referral `amount>0` → «Кэшбэк от покупок друга». Все строки `status: 'confirmed'`.
- Карта: прогресс от серверного `cupsForFree`, фраза «Ещё N стаканов до бесплатного» (`CardPage.tsx:35-38,142`, `plural.ts:16-21`).
- Реферал: процент берётся из `directory` (`InvitePage.tsx:12`), текст «Каждый 6-й кофе бесплатно» — хардкод (`:19,74`).
- Юридический текст: `app_settings.legal_loyalty`, иначе fallback `public/routes.ts:14` (дубль в `frontend/src/copy/ru.ts:38`).

**Чего в истории нет**

| Состояние | Где есть | В истории |
|---|---|---|
| Списание кэшбэка | `loyalty_ledger.cashback_delta<0` | нет |
| Отрицательный referral (сторно) | `cashback_ledger.amount<0` | нет (фильтр `amount>0`) |
| Причина отказа / клэмп | `disputes`, `loyalty_ops.free/cb=0` | нет |
| Жизненный цикл ваучера | `vouchers.used_at/receipt_id` | нет |
| Дубли/повтор документа | `reason='duplicate'` | нет |
| `ALREADY_RESERVED`, истёкший резерв | `loyalty_reservations.status` | нет |
| `SELL` без карты | лог `skip no loyalty extra` | нет |

[В] Плюс асимметрия: «Друзья» — нетто, история — только плюсы (L-19).

---

## 13. Дефекты (финальные severity)

| ID | Severity | Суть | Доказательство (HEAD) | Что делать |
|---|---|---|---|---|
| **L-00** | **P0** | APK кладёт в `sc.c` числовой код вместо подписанного токена → подарок и кэшбэк не списываются, `free_used`/`cashback_balance` не уменьшаются | `evotor-app:CardSession.kt:84-87` (регрессия `57a5c5f`); `SellHandler.ts:150,204-207` | Вернуть `sc.c = info.code` для QR, числовой код — только ручной ввод; контрактный тест «APK payload ↔ handleSell» |
| L-01 | P1 accounting | PAYBACK сторнирует referral на полную сумму в ledger, баланс с полом 0 → расхождение | `SellHandler.ts:289-300` | Писать в ledger фактически снятую сумму + отдельная строка списания |
| L-02 | **P2** (+[RUNTIME]) | Три канала, у двух «receipt»-каналов непересекающиеся ключи в одной таблице → возможен двойной учёт | `app.ts:145-158`, `sales.ts:36`, `receipts.ts:114` | Канонический fiscal-id + cross-channel unique **или** документированная эксклюзивность + алерт; приоритет низкий, пока клиентов нет |
| L-03 | P1 | Квалификация чашек расходится: uuid-мэппинг против `productId` + regex по имени | `SellHandler.ts:113-135` vs `sales.ts:53-66` | Единый resolver; rollout в режиме report-only |
| L-04 | P2 diagnostic | `sequenceMatches` захардкожен `true`; `sc.q` APK не отправляет (N-01) → рассинхрон sequence не виден | `SellHandler.ts:208,244`; `CardSession.kt:83-93` | Отправлять `q`, логировать расхождение, **не** отклонять чек |
| L-05 | P1 (когда канал включат) | receipt-sync применяет дельты частично: при нехватке кэшбэка `cards` и ledger уже изменены | `receipts.ts:42-49,59-68` | Атомарный отказ либо явная фиксация частичного применения в результате |
| L-06 | P1 (когда канал включат) | Погашение ваучера: `UPDATE` без `used_at IS NULL`, `changes` не проверяется | `receipts.ts:70-76` | `UPDATE … WHERE id=? AND used_at IS NULL` + `changes===1`, иначе dispute |
| L-07 | P1 data loss | PAYBACK без базового SELL (и любой упавший документ) → `FAILED`, ретрая нет | `SellHandler.ts:258`; `PollService.ts:173-177,195-226` | Очередь отложенных PAYBACK + повтор при появлении базы + алерт |
| L-08 | P1 | В истории нет причин, списаний, сторно и ваучеров | `sync/routes.ts:25-48` | Маппинг безопасных причин из `loyalty_ledger`/`disputes` |
| L-09 | P1 | WELCOME не выдаётся: оба места — в каналах без клиента, в Evotor выдачи нет | `receipts.ts:51-57`, `sales.ts:90-92`; в `SellHandler` нет | Выдавать в Evotor при первой оплате **или** убрать обещание из текстов |
| L-10 | P2 | Нет уникальности `(user,template)` при выдаче ваучера | `vouchers/service.ts:8-15`; `admin/routes.ts:1267-1274` | Идемпотентный ключ или проверка существующего |
| L-12 | P2 | Модели сроков кэшбэка нет, только агрегат баланса | `schema.ts:8` | Не вводить expiry без лотов |
| L-13 | P1 | `counts_as_cup` и `free_eligible` — разные поля, легко перепутать в админке | `004:1`, `005:10`, `SellHandler.ts:113` | Подписи/валидация в каталоге, отчёт расхождений |
| L-14′ | P2 | «Каждый шестой» верно для дефолта 5, но **захардкожено** в 4 местах при конфигурируемом пороге | `public/routes.ts:14`, `copy/ru.ts:38`, `InvitePage.tsx:19,74`, `seed.ts:90` | Брать N из `directory.cupsForFree` в копирайт и шаблон промо |
| L-15 | P2 | Disputes без статусов и оператора | `admin/routes.ts:1277-1278` | Добавить статус, если вырастет объём обращений |
| L-16 | P2 | `pushEnabled` в `/api/public/content` всегда `false` | `public/routes.ts:28` читает `config.pushEnabled`, флаг в `evotorConfig` (`config.ts:61`) | Читать `evotorConfig.pushEnabled` |
| L-17 | P2 | Контракт утверждает, что APK проверяет Ed25519 QR; в APK проверки нет | `ANDROID_INTEGRATION_CONTRACT.md:79-83` vs отсутствие крипто-кода | Привести документ к факту или реализовать проверку |
| L-18 | P2 | Админ-статистика рефералов видит покупки только Evotor-канала | `admin/routes.ts:1111-1113`; `studio.ts:1159` | Считать по `cashback_ledger`/`receipts` |
| L-19 | P2 | «Друзья» — нетто, история — только плюсы | `cardLookup.ts:33-35` vs `sync/routes.ts:34-36` | Показывать сторно отдельной строкой |
| L-20 | P2 | `free_cup_overdraw` — только dispute после факта, без клэмпа | `receipts.ts:78-81` | Клэмп по `freeEarned` до применения |
| L-21 | P2 | `503 proxy_not_configured` кассир видит как «сервер недоступен» | `devices/routes.ts:46`; `LoyaltyApi.kt:57-58` | Отдельное сообщение «сервер не настроен, обратитесь к администратору» |

---

## 14. Market (кратко, без расширения scope)

| Практика | Публичные примеры | Сейчас в 6.7 | Комментарий |
|---|---|---|---|
| Чашки/визиты vs баллы | Starbucks Rewards (Stars), Dunkin Rewards (points) | прогресс чашек + отдельный кэшбэк | Не смешивать «чашки до подарка» и «кэшбэк ₽» |
| Бесплатный после N | у сетей обычно указан квалифицирующий товар и лимиты | `cupsForFree` + `counts_as_cup` + `free_used` | Публиковать список участвующих позиций и влияние возврата |
| Tier / день рождения / пуш | описаны в публичных правилах Starbucks/Dunkin | нет подтверждённых | Не делать до стабилизации ledger и согласия/инфраструктуры |
| Referral | одно- и двусторонний | начисление приглашающему, не одноразовое | Публично указать, кто и за что получает |
| Expiry | у баллов/промо бывает | ваучер истекает, кэшбэк — нет | Не вводить молча |

Источники (проверить регион перед использованием как политики):
- Starbucks Rewards Terms — https://www.starbucks.com/terms/rewards
- Starbucks Rewards FAQ — https://about.starbucks.com/starbucks-rewards-faq/
- Dunkin Rewards Terms — https://www.dunkindonuts.com/dunkin-rewards-terms-and-conditions/
- Dunkin Rewards FAQ — https://www.dunkindonuts.com/en/dunkinrewards.html

[Р] Иллюстрации паттернов, не рекомендации копировать пороги. Локальные РФ-программы и Square Loyalty в этом проходе не верифицированы и не приводятся.

---

## 15. Implementation backlog (упорядоченный)

| # | Приоритет | Задача | Acceptance criteria (одна строка) | Complexity |
|---:|---|---|---|---|
| 0 | **P0 blocker** | L-00: вернуть подписанный QR-токен в `extras.sc.c` (числовой код — только ручной ввод) + контрактный тест | Чек с QR и `free=1` даёт `cards.free_used +1` и `loyalty_ops.free=1`; повторный скан не даёт второй подарок | **S** |
| 1 | P1 | Публичные правила: N и % брать из конфига, один канонический текст (копирайт, промо-сид, шаринг, legal) | Ни одного захардкоженного «6» / «3%» в UI и промо; текст совпадает с `directory.cupsForFree` | S |
| 2 | P1 | Channel exclusivity evidence/guard: канонический fiscal-id + cross-channel unique **или** документированная эксклюзивность + алерт на пересечение | Один контролируемый чек, отправленный дважды, даёт одну строку и один набор дельт | M/L |
| 3 | P1 | PAYBACK retry + обработка «base missing» + алерт после лимита | PAYBACK без базы обрабатывается автоматически после появления SELL, без двойного сторно | M |
| 4 | P1 | Voucher atomic UPDATE | Два разных чека не могут погасить один ваучер; успешным считается только `changes===1`, второй уходит в dispute | S |
| 5 | P1 | Referral ledger reconciliation | Для каждого начисления `reversed + retained + written_off = original`; сумма ledger равна изменению баланса | M |
| 6 | P1 | Unified cups resolver для Evotor и online-sale | Один товар даёт одинаковый результат в обоих каналах; rollout начинается в report-only | M |
| 7 | P1 | PWA: причины и полный ledger в истории | Гость видит покупку, списание, начисление/сторно реферала, ваучер и возврат с понятным статусом и без дублей SELL | M |
| 8 | P2 (явно **не** делать) | Expiry кэшбэка, tiers, birthday, SaaS-замена | Явно отложено до стабилизации правил, ledger и согласия/инфраструктуры | — |

Гардрейлы: `sc.q` сначала warn-only; ручная корректировка баланса, если появится, обязана требовать причину/оператора и писать строку ledger.

---

## 16. Out of scope

- Замена Эвотора и обязательный внешний SaaS-лояльности.
- Изменение механики карта/QR/короткий код; QR остаётся credential, сервер — источник истины.
- PWA как касса/оплата.
- Смешивание склада и лояльности: чек без карты не должен блокировать складскую обработку.
- Изменение порога, процента, TTL, условий ваучеров и приоритета списания без конфиг-факта и решения владельца.
- Expiry, tiers, birthday, двусторонний реферал «потому что у рынка так».
- Удаление и перезапись исторических `loyalty_ops`, `loyalty_ledger`, `cashback_ledger`, `receipts`, `vouchers`, `disputes` до сверки.

---

## 17. Sources (проверено на HEAD)

### sixth-cup @ `1ca194b`

**Конфиг и bootstrap**
- `backend/src/config.ts:28-34,37-40,51-65`
- `backend/src/app.ts:145-158`
- `backend/src/index.ts:21-86`

**Evotor-канал**
- `backend/src/integrations/evotor/processing/SellHandler.ts:106-111,113-135,140-249,251-303`
- `backend/src/integrations/evotor/sync/PollService.ts:16,119-124,155-178,195-231,242-246`
- `backend/src/integrations/evotor/loyaltyExtras.ts:8-33`
- `backend/src/integrations/evotor/db.ts:92-107,109-120,122-127`

**Лояльность**
- `backend/src/modules/loyalty/rules.ts:3-5`
- `backend/src/modules/loyalty/reservations.ts:54-101,108-118,120-124`
- `backend/src/modules/loyalty/receipts.ts:38-96,98-131`
- `backend/src/modules/loyalty/cardLookup.ts:21-30,32-36,38-57`
- `backend/src/modules/devices/sales.ts:31-107`
- `backend/src/modules/devices/routes.ts:41-72,539-561`
- `backend/src/modules/vouchers/service.ts:8-15,17-25`
- `backend/src/modules/sync/routes.ts:11-12,25-48,49-59`
- `backend/src/modules/game/routes.ts:3,15,28-45,126-172`

**Админка и текст**
- `backend/src/modules/admin/routes.ts:1107-1121,1267-1274,1277-1278`
- `backend/src/modules/admin/console.ts:50,90,175-197,404-413`
- `backend/src/modules/admin/studio.ts:1155-1165`
- `backend/src/modules/public/routes.ts:13-19,21-30`
- `backend/src/modules/directory/routes.ts:155-156`
- `backend/src/db/seed.ts:77-82,90,154`

**Схема**
- `backend/src/db/schema.ts:2-46,65-95`
- `backend/src/db/migrations/004_counts_as_cup.sql:1`
- `backend/src/db/migrations/005_loyalty_catalog_security.sql:3-17`
- `backend/src/db/migrations/008_card_code.sql:3-10`
- `backend/src/db/migrations/011_loyalty_reservations.sql:1-18`

**Тесты (запущены read-only)**
- `backend/src/__tests__/loyalty-extras.test.ts`, `loyalty-rules.test.ts`, `reservations.test.ts` (`:55-101,110-120`), `referral.test.ts`, `sell-fixture.test.ts`, `sync-history.test.ts`, `card-code.test.ts` → **7 файлов / 38 тестов, все passed**

**Фронтенд**
- `frontend/src/pages/HistoryPage.tsx:10-11,107`
- `frontend/src/pages/InvitePage.tsx:12,19,74`
- `frontend/src/pages/CardPage.tsx:35-38,142`
- `frontend/src/lib/plural.ts:11-21`
- `frontend/src/copy/ru.ts:38`

**Документы**
- `ANDROID_INTEGRATION_CONTRACT.md:79-83`
- `docs/DEVICE-SALES.md:1-20`

### evotor-app @ `216bf88`

- `app/src/main/java/ru/sixthcup/evotor/data/CardSession.kt:11-26,33,45-48,73-80,83-93,96`
- `app/src/main/java/ru/sixthcup/evotor/data/DiscountCalc.kt:17-18,25-45`
- `app/src/main/java/ru/sixthcup/evotor/integration/DiscountIntegrationService.kt:26-70`
- `app/src/main/java/ru/sixthcup/evotor/net/LoyaltyApi.kt:17-66,68-75`
- `app/src/main/java/ru/sixthcup/evotor/ui/MainActivity.kt:2840-2847,2934-2936`
- `app/src/test/java/ru/sixthcup/evotor/data/CardSessionExtrasTest.kt:30-56`
- Регрессия: `57a5c5f` — было `put("c", info.code)`, стало `cardCode.ifBlank { code }`

---

## 18. Verification limits

**Чем подтверждено**

- Все `file:line` — чтение на HEAD `1ca194b` (sixth-cup) и `216bf88` (evotor-app).
- L-00 проверена сквозным чтением: APK payload → `getSc` → ветвление `isToken` → `consumeReservation`. Подкреплена существующими тестами: `reservations.test.ts:76` (токен → `free_used=1`) и `reservations.test.ts:94-101` (числовой код → без льгот) — то есть backend ведёт себя ровно так, как описано, а APK посылает именно числовой код.
- Loyalty-тесты запущены read-only: `vitest run` по 7 файлам → **38 passed**; файлы тестов не изменялись, рабочая БД не затрагивалась (изолированная БД через `setup-isolated-db.ts`).

**Чего код не доказывает (нужен прод/устройство)**

1. **Прод-значения конфига**: `CUPS_FOR_FREE`, `RESERVATION_TTL_SEC`, `CARD_QR_TTL_SEC`, `EVOTOR_PUSH_EXTRAS`, `EVOTOR_PROXY_ENFORCE`, фактический WELCOME-шаблон в БД, `appId` в кабинете Эвотора.
2. **Включён ли Evotor-poll в проде**: есть ли `EVOTOR_API_TOKEN` и `evotor_stores.sync_enabled=1`. Без этого канал не работает, и тогда лояльность не начисляется вообще (но L-00 всё равно нужно исправить до включения).
3. **Сколько денег уже потеряно на L-00** — измеряется только по проду (см. ниже).
4. **DDL прод-БД** совпадает ли с `schema.ts` / `evotor/db.ts` (код полагается на PK/UNIQUE).
5. **Живой терминал**: установка APK (сейчас debug-подпись), фактическое содержимое `extras` в облачном документе Эвотора, реакция на `ALREADY_RESERVED`, поведение при потере сети между скидкой и SELL.
6. **Гонки при 2+ инстансах backend** (L-06): в одном процессе `applyReceipts` транзакционен.

**Безопасные запросы для измерения (только чтение)**

- Сколько выдач без списания: `SELECT COUNT(*) FROM loyalty_ops WHERE kind='SELL' AND (free>0 OR cb>0);` рядом с числом SELL, где в `op_claimed` есть `R-` (проверяется по `raw`/логам, в `loyalty_ops` `op_claimed` пишется).
- Сколько «зависших» резервов: `SELECT status, COUNT(*) FROM loyalty_reservations GROUP BY status;`
- Сколько потерянных возвратов: `SELECT last_error, COUNT(*) FROM evotor_docs WHERE status='FAILED' GROUP BY last_error;`
- Сверка: для тестовой карты и согласованного чека малой суммы — `cards`, `loyalty_ops`, `loyalty_ledger`, `cashback_ledger`, `loyalty_reservations` до/после. Без экспорта секретов и сырых подписанных токенов, без ретро-правок истории.

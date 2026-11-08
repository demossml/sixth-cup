# Прогресс исправлений аудита — sixth-cup (backend + admin + PWA)

Источник: `2n.md` (WAVE 0 → WAVE 3). Ветка `main`, базовый HEAD на старте: `7d88474`.
Правило: одна задача = коммит-блок изменений + прогон тестов; push **не** делаем без команды владельца.

---

## W0-1 — baseline

| Что | Значение |
|---|---|
| HEAD на старте | `7d88474` (`fix(stores): юрлица не нужны, вся витрина точки — в карточке кассы`) |
| `git status` | чисто |
| backend tests (baseline) | **97 файлов / 673 теста — pass** |
| Модули якорей | `modules/orders/service.ts` (`resolveLine`, `evotorUuidForProduct`, `expireIfNeeded`), `integrations/evotor/processing/SellHandler.ts` (`sc.ord`, `preorderBenefitOf`), `modules/devices/routes.ts` (`POST /enroll`) |

Замечания по якорям (факт, не подгоняли):

- `resolveLine` брал `name` и `priceRub` **из запроса** → B-01/B-03 подтверждены.
- `sc.ord` в `SellHandler` — это id **очереди** (`queue_numbers`), а `preorderBenefitOf` искал по нему
  заказ → B-04 подтверждён (id очереди подставлялся как id заказа).
- `POST /enroll` не имел TTL кода, лимитов и проверки формата ключа → B-06/S-1 подтверждены.
- `markPaid` не принимал контекст оплаты и закрывал заказ при любом статусе кроме `paid` → B-08 (часть).

---

## WAVE 1 — P0

### P0-5 — бан только за реальный невыкуп (B-05)

- Файлы: `backend/src/modules/orders/service.ts` (+ тесты `preorder-lifecycle.test.ts`).
- Логика: `expireIfNeeded` ставит бан только если заказ был `accepted|cooking|ready` и не оплачен.
  `draft` истёк → `expired` без бана.
- Тесты: draft истёк → `bannedUntil` нет, новый заказ сразу доступен; принятый и истёкший → бан,
  `403 preorder_banned`, снятие бана из админки; бан истекает сам. **pass**

### P0-1 — серверные цена и состав заказа (B-01, B-03, B-07)

- Файлы: `backend/src/modules/orders/pricing.ts` (новый резолвер), `orders/service.ts`,
  `orders/benefit.ts`, `orders/types.ts` (`ModifierOut.warning`), `frontend` (не шлём цену),
  тесты `order-pricing.test.ts`, `preorder-benefit.test.ts`, `preorder-service.test.ts`.
- `resolveItemModifiers(db, sku, basePrice, modifiers)` — единственный источник цены/имени:
  опции берутся из схемы добавок товара (canonical `modifier_scheme_options`, legacy
  `modifier_scheme_items`) и из схемы молока. Клиентские `priceRub`/`name` игнорируются.
- Ошибки: `modifier_not_allowed` (чужая опция), `modifier_limit` (превышен maxCount); quote и
  создание заказа используют один резолвер — суммы совпадают (B-07).
- PWA: корзина больше не отправляет `priceRub`/`name` (только `groupKey` + `modifierId`).
- Тесты: `priceRub: 0` не занижает; чужая опция → 400/409; quote = order по сумме;
  превышение maxCount → `modifier_limit`. **pass**

### P0-2 — uuid модификаторов (B-02)

- Файлы: `orders/service.ts` (`resolveLine` резолвит uuid по `productId` из схемы), `loadOrder`
  собирает `warnings`.
- Нет связи товара с точкой → `evotorUuid: null`, `warning: 'no_evotor_uuid'` в модификаторе и
  строка в `order.warnings`. Заказ при этом создаётся (uuid не выдумываем).
- Тесты: `order-pricing.test.ts` — с link uuid заполнен; без link null + warning. **pass**

### P0-4 — безопасность enroll (B-06, S-1)

- Миграция `050_device_enroll_security.sql` (+ rollback): `devices.enroll_expires_at`, `key_bound_at`.
- Файлы: `modules/devices/routes.ts`, `modules/admin/routes.ts` (код создаётся с TTL 15 мин,
  `ENROLL_TTL_MIN`), `config.ts` (`TRUST_PROXY_HEADERS`), `lib/errors.ts` (добавлен статус 410).
- Правила: код живёт 15 минут (`410` после истечения); повторная регистрация тем же кодом → `409`;
  формат `publicKey` — 32…64 символа base64/base64url/hex (иначе `400`); лимит по коду 5 попыток
  (lockout 15 мин) и по IP 10 попыток / 10 мин (IP — только из доверенных заголовков);
  все неудачи и успех пишутся в лог.
- ASSUMPTIONS: challenge-proof для публичного ключа не вводили (APK-контракт без изменений) —
  закрываем риск TTL + лимитами + одноразовой привязкой; полноценный challenge — P1.
- Тесты: истёкший код `410`, повтор `404/409`, перебор кода `429`, enroll с валидным ключом `200`. **pass**

### P0-3-BACKEND — контракт льготы предзаказа (B-04, backend)

- Файлы: `integrations/evotor/processing/SellHandler.ts` (`ScClaim.preorder`, `looksLikeOrderId`,
  `resolvePreorderId`), `docs/PREORDER-SC-CANON.md`, тест `sc-preorder-canon.test.ts`.
- Канон: `sc.preorder` = id заказа. `sc.ord` = id очереди, заказом **не** считается; fallback на
  `sc.ord` только для uuid-подобного значения и существующего заказа + предупреждение в лог
  (deprecation для старых сборок APK).
- Тесты: `sc.preorder` → льгота списывается; `sc.ord: '42'/'111111'` → резерв не тронут;
  `sc.ord` с uuid заказа → legacy fallback; неизвестный `sc.preorder` → льгот нет. **pass**
- Для APK-агента: писать `sc.preorder = order id`, не класть order id в `sc.ord`.

### P0-6-BACKEND — mark-paid (B-08, backend)

- Миграция `051_preorder_payment_context.sql` (+ rollback): `preorders.fiscal_document_number`,
  `paid_amount`, уникальный индекс по фискальному номеру.
- Файлы: `orders/service.ts` (`markPaid(db, id, payment)`), `orders/routes.ts`, `modules/admin/routes.ts`
  (необязательное тело `{fiscalDocumentNumber?, amountRub?}`).
- Правила: идемпотентно (повтор → тот же заказ); отменённый/отклонённый/истёкший оплатить нельзя
  (`409 invalid_transition`); расхождение суммы → `409 amount_mismatch`; чужой фискальный номер →
  `409 duplicate_fiscal`. Старые вызовы без тела работают как раньше.
- Тесты: повтор, отмена, `amount_mismatch`, `duplicate_fiscal`. **pass**

### W1-SELF — самопроверка

- backend: **98 файлов / 693 теста — pass** (полный прогон).
- frontend: 92 теста — pass; frontend-admin: 72 теста — pass.
- `npm run typecheck` (3 воркспейса) и `npm run build` — зелёные.

Baseline был зелёным; после P0 всё осталось зелёным.

---

# WAVE 2 — P1

### P1-4 — IDOR: NULL guest_user_id не открывает заказ

- Файлы: `modules/orders/service.ts` (`ownedOrder`, `cancelDraft`, `markPickedUp`).
- Было: заказ, созданный без гостя (`guest_user_id IS NULL`), мог быть получен/отменён любым
  авторизованным гостем, если сравнение `NULL` проходило как «не равно». Стало: заказ принадлежит
  только конкретному `userId`; NULL-владелец не совпадает ни с кем.
- Тесты: попытка открыть чужой/NULL-заказ → `404`. **pass**

### P1-2 — доверенный IP вместо сырого X-Forwarded-For

- Файл: `backend/src/lib/clientIp.ts` (новый) + заменено в `auth/routes.ts`, `upload/routes.ts`,
  `devices/routes.ts`, `admin/routes.ts`, `admin/audit.ts`, `admin/console.ts`.
- IP берётся из `X-Forwarded-For`/`X-Real-IP` только при `TRUST_PROXY_HEADERS=1`, иначе — адрес
  сокета. Иначе клиент подделывал заголовок и обходил любой IP-лимит.
- Тесты: полный прогон backend (694 на этом шаге). **pass**

### P1-5 — явный масштаб денег на точке

- Миграция `052_store_money_scale.sql`: `stores.money_scale` (`auto|rub|kopecks`, default `auto`).
- Файлы: `integrations/evotor/processing/SellHandler.ts` (`moneyScaleForStore`, `amountKopecks(scale)`),
  `modules/admin/routes.ts` (`PATCH /stores/:id` принимает `moneyScale`, при отсутствии сохраняет текущий).
- Эвристика «есть цена ≥ 1000 → копейки» осталась только для `auto` (обратная совместимость).
- Тесты: `money-scale.test.ts` — rub/kopecks/auto. **pass**

### P1-1 — онлайн-продажа с кассы не начисляет что угодно

- Файл: `modules/devices/sales.ts`.
- Лимит чашек за чек (`MAX_CUPS_PER_SALE`, default 20), частотный лимит по терминалу
  (`SALES_PER_DEVICE_HOUR`), отказ при `amountRub = 0` и чашках > 0, запрет повторного использования
  одного фискального номера с другого терминала (`fiscal_duplicate` + запись спора).
- Тесты: `online-sale-hardening.test.ts` (4). **pass**

### P1-3 — Idempotency-Key и один активный заказ

- Миграция `053_preorder_idempotency.sql`: частичный уникальный индекс «один активный заказ на гостя»
  + таблица `idempotency_keys`.
- Файлы: `modules/orders/service.ts` (`idempotentOrder`, `findIdempotentOrder`, `rememberIdempotency`),
  `modules/orders/routes.ts` (заголовок `Idempotency-Key`; replay проверяется **до** проверки активного
  заказа, иначе retry получал `409` вместо своего заказа).
- Тесты: `order-idempotency.test.ts` (4): повтор с тем же ключом → тот же заказ, другой ключ при активном
  заказе → `409 active_order_exists`. **pass**

### P1-6 — отзыв JWT (token_version)

- Миграция `054_user_token_version.sql`: `users.token_version`.
- Файлы: `middleware/auth.ts` (сверка `ver` с БД), `modules/auth/routes.ts` (`jwtFor` кладёт `ver`,
  новый `POST /api/auth/revoke`, `/restore` инкрементит версию), `db/seed.ts`, `modules/dev/routes.ts`,
  `frontend/src/pages/ProfilePage.tsx` (сброс карты сначала отзывает токены).
- Тесты: `token-revoke.test.ts` (4): свежий токен живой, после `/revoke` → `401`, легаси-токен без `ver`
  тоже отзывается, восстановление по коду отзывает токены прежнего устройства. **pass**

---

# WAVE 3 — P2

### P2-1 — схема предзаказов не создаётся на каждый запрос

- Файл: `modules/orders/service.ts`: `ensurePreorderTables` мемоизирован через `WeakSet` по соединению,
  добавлен догон колонок `fiscal_document_number` / `paid_amount` для старых БД.
- Тест: повторные вызовы не выполняют DDL. **pass**

### P2-2 — индексы preorder_*

- Миграция `055_preorder_indexes.sql`: `preorders(guest_user_id,status)`, `preorders(created_at)`,
  `preorders(status,expires_at)`, `preorder_items(order_id)`,
  `preorder_item_modifiers(order_item_id)`, `preorder_bans(until)`.
- Тест: индексы присутствуют. **pass**

### P2-3 — ограниченный параллелизм опроса точек

- Файл: `lib/concurrency.ts` (`mapLimit`) + `integrations/evotor/sync/PollService.ts` (`runFast`).
- `EVOTOR_POLL_CONCURRENCY` (default 3; 1 = прежнее последовательное поведение).
- Тесты: `mapLimit` обрабатывает все элементы, пик параллелизма ≤ limit, пустой список и limit=0. **pass**

### P2-4 — метрики доставки push

- Файл: `modules/push/service.ts` (`pushMetrics`: подписки/живые/отозванные/падающие/доставленные),
  `modules/admin/console.ts` (поле `push` в health-ответе + исключение «Push-подписки с ошибками доставки»).
- ASSUMPTIONS: в аудите пункт назван «metrics: imported в push»; `imported` — счётчик импорта каталога,
  он уже отдаётся в pull-метриках (`pulled.imported`). Здесь закрыт реальный пробел наблюдаемости push:
  без этих счётчиков «мёртвые» подписки копились молча.
- Тест: `pushMetrics` считает живые/падающие/отозванные. **pass**

### P2-6 — CORS whitelist

- Файлы: `config.ts` (`CORS_ORIGINS`), `app.ts` (`isAllowedOrigin`).
- Прод отдаёт PWA и админку с того же домена, поэтому по умолчанию разрешены только same-origin
  (без `Origin`) и dev-хосты `localhost`/`127.0.0.1`. Для отдельно размещённых клиентов — `CORS_ORIGINS`.
  Разрешены заголовки `Authorization`, `Idempotency-Key`, `X-Admin-Token`.
- Тесты: чужой origin не получает `Access-Control-Allow-Origin`, localhost — получает. **pass**

### P2-8 / P2-9 — лимиты чувствительных вызовов

- Файл: `lib/rateLimit.ts` (`allowRequest`), применён к `POST /api/orders/quote` (120/мин на гостя),
  `POST /api/push/subscribe` (20/час на гостя), `POST /api/auth/recovery` (5/час на гостя).
- Существующие лимиты сохранены: `/api/auth/guest` 30/час по IP, `/api/auth/restore` 10/час по IP,
  `/api/loyalty/card` 60/мин.
- Тесты: окно `allowRequest`, quote → `429` после исчерпания. **pass**
- ASSUMPTIONS: отдельного «welcome»-эндпоинта в коде нет (welcome-ваучер выдаётся внутри бонусов и
  начисляется по факту оплаченной покупки), поэтому лимит на него не добавлялся.

---

# Итоговые числа (после WAVE 3)

- backend: **104 файла / 718 тестов — pass**
- frontend: 92 теста — pass; frontend-admin: 72 теста — pass
- `npm run typecheck` (3 воркспейса), `npm run build` — зелёные

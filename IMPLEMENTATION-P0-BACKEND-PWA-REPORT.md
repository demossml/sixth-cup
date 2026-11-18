# IMPLEMENTATION — P0 Backend + PWA (серия A)

**Дата:** 18.11.2026
**Ветка:** `main`
**HEAD до серии:** `8cbe125` (menu-poster-integration)
**Область:** только Backend + PWA. APK-репозиторий не трогался.

---

## Гейты

| Проверка | До серии | После серии |
|---|---|---|
| `npm run typecheck` | 4/4 ✔ | **4/4 ✔** |
| backend тесты | 139 файлов / 1072 | **148 файлов / 1125** ✔ |
| PWA тесты | 13 / 145 | **13 / 145** ✔ (код PWA не менялся) |
| админка | 35 / 332 | **35 / 332** ✔ |
| сборка backend (`tsup`) | ✔ | ✔ |
| живой запуск `NODE_ENV=production` | — | ✔ (см. P0-04) |

Новых тестов: **9 файлов, +53 теста**.

---

## P0-01 — fail-open авторизация кассовых API

**Что было.** `evotorProxyStrict` при пустом `EVOTOR_PROXY_TOKEN` вызывал `next()`, то есть
«закрытый» контур открывался сам, если переменную забыли задать. Муфта `/api/orders/*` использовала
_мягкий_ `evotorProxy` (только предупреждение в лог), а `deviceStoreAuth` принимал один
`X-Evotor-Store-Uuid` как достаточный credential — то есть экран заказов и смена статусов
были доступны без секрета.

**Изменения.**
- `backend/src/middleware/evotorProxy.ts` — `proxyCredentialValid()` (fail-closed) + `evotorProxyStrict`
  больше не пропускает: нет токена → `503 proxy_not_configured`, неверный → `403 proxy_forbidden`.
- `backend/src/middleware/deviceStore.ts` — без `X-Device-Token` требуется валидный прокси-токен
  (`503` если контур не настроен, `401` если токена нет/неверный). Заголовок точки остался только
  маршрутизацией.
- `backend/src/modules/orders/routes.ts` — `/api/devices/orders/*` без мягкой мидлвари.
- `backend/src/modules/staff/deviceRoutes.ts` — shift/timesheet/breaks под `evotorProxyStrict`
  (пути перечислены явно: `.use('*')` на под-приложении перехватывал и чужие маршруты).
- `backend/src/modules/devices/routes.ts` — `/ping` больше не рапортует `authOk: true` при пустом
  токене; добавлено поле `configured`.
- `backend/src/config.ts` — production без `EVOTOR_PROXY_TOKEN` не стартует.

**Самопроверка.** `device-proxy-failclosed.test.ts` (9): без токена `shift/summary`, `orders/active`,
`orders/:id/status`, `customers/register`, `customers/lookup`, `resolve`, `logs` → `503`;
`/ping` остаётся диагностическим. `device-proxy-auth.test.ts` (8): с валидным токеном всё работает,
`X-Evotor-Store-Uuid` без токена → `401`, чужой токен → `403/401`, статус заказа не меняется.

**Риск регрессии.** Живой APK присылает `Authorization` (это зафиксировано в `device-orders-auth.test.ts`),
поэтому поток кассы сохранён. ⚠️ **Локальная разработка без `EVOTOR_PROXY_TOKEN` теперь получает 503** —
токен нужно задать в `.env` (см. `.env.example`).

---

## P0-02 — номера карт и списание по номеру

**Что было.** `card_code = MAX+1` (перебор тривиален), `canRedeem: true` для числового кода и для
телефона без подтверждения, лимита по самому номеру карты нет.

**Изменения.**
- `backend/src/modules/loyalty/proof.ts` — код из `crypto.randomInt` (10 цифр), до 8 попыток,
  UNIQUE ловится и повторяется. Старые короткие коды работают (`normalizeCardCode` — 1…18 цифр).
- `backend/src/modules/loyalty/reservations.ts` — `kind: 'phone'`; числовой код → `canRedeem: false`,
  без резерва и ваучеров; телефон → списание только при `phoneConfirmed`.
- `backend/src/modules/loyalty/phoneProof.ts` (новый) — device proof: подтверждение номера живёт
  10 минут и привязано к терминалу/точке, пишется только при успешном `customers/lookup|register`.
- `backend/src/modules/devices/routes.ts` — proof пишется в lookup/register; лимит **по номеру карты**:
  5 промахов в 10 минут → `429 card_locked` (независимо от терминала).

**Самопроверка.** `loyalty-card-security.test.ts` (5): коды 10-значные, не подряд, уникальные;
старый код `12` идентифицирует и не даёт списывать; 5 промахов → `card_locked`, другой номер работает.
`loyalty-bonus-resolve.test.ts` обновлён: код → `canRedeem: false`, телефон без lookup → `false`,
после lookup этой же кассой → `true` + резерв, lookup с другого терминала не помогает.

**Остаточный риск (осознанно).** `SellHandler` в бонусном режиме по-прежнему режет списание по
балансу, а не по резерву, — то есть сервер не отклонит `sc.cb` от кассы, если та сама его применила
по числовому коду. Закрытие требует менять продуктовое правило (списание только по резерву) и
переписать 13 тестов бонусной продажи — это отдельное решение владельца, не техническая правка.

---

## P0-03 — атомарность заказа и гонки при оплате

**Изменения (`backend/src/modules/orders/service.ts`).**
- `createDraftOrder` целиком в транзакции (`preorders` + `preorder_items` + `preorder_item_modifiers`
  + `idempotency_keys`); хелпер `tx()` включает транзакцию только при наличии `db.transaction`,
  поэтому тестовые заглушки не меняются.
- `markPaid` — транзакция + условный `UPDATE ... WHERE id=? AND status IN ('accepted','cooking','ready')`;
  `changes === 0` → повтор уже оплаченного возвращает заказ, любой другой статус → `409 invalid_transition`.
- `transitionStatus` — условный `UPDATE ... AND status = <прочитанный>`; повтор того же статуса
  идемпотентен, чужой переход → `409`.

**Самопроверка.** `orders-atomicity.test.ts` (7): заголовок и состав пишутся вместе; повтор с
`Idempotency-Key` не создаёт второй заказ; `mark-paid` дважды не переписывает `paid_at`;
отменённый/черновой заказ оплатить нельзя (409, статус не меняется); `ready` дважды — ок,
`paid → cooking` и `rejected → ready` — 409.

---

## P0-04 — production-конфигурация

- `backend/src/config.ts` — `CRITICAL_PROD_ENV` + чистая `productionConfigIssues()`; при
  `NODE_ENV=production` приложение падает на старте со списком отсутствующих переменных:
  `JWT_SECRET`, `ADMIN_TOKEN`, `EVOTOR_PROXY_TOKEN`, `PUBLIC_BASE_URL`, `TRUST_PROXY_HEADERS`.
  Дополнительно: dev-значения секретов, `TRUST_PROXY_HEADERS ∉ {0,1}`, `PUBLIC_BASE_URL` без схемы.
- `.env.example` (новый) — полный список с комментариями.
- `DEPLOYMENT.md` — таблица критических переменных, минимальный прод-конфиг, команда проверки.

**Самопроверка.**
- `prod-config-startup-blocked.test.ts` — импорт `config` в production без переменных бросает
  `Production config incomplete` с именами.
- `prod-config-startup-ok.test.ts` — с полным набором конфиг загружается (`isDev === false`).
- `trust-proxy-headers.test.ts` + кейс в `device-proxy-failclosed.test.ts` — `X-Forwarded-For`
  учитывается только при `TRUST_PROXY_HEADERS=1`.
- Живой прогон собранного `backend/dist/index.js`:
  `NODE_ENV=production` без переменных → падение с полным списком;
  с переменными → миграции 001…074, `6.7 Coffee API: http://localhost:3999`,
  `/health` 200, `resolve` без токена 403, с токеном 404 `card_not_found` (авторизация пройдена).

---

## H-01 / H-02 / H-03

**H-01 (`backend/src/modules/orders/availability.ts`, новый).**
- Точка: организации с `active = 0` → `store_unavailable` (quote и create).
- Товар: блокируется только при **явно выключенной** привязке `product_store_links.enabled = 0`;
  отсутствие строки привязки не блокирует (иначе любой неснихронизированный товар исчез бы из
  предзаказа). Нет таблиц/колонок в старой базе — не блокируем.

**H-02 (`backend/src/modules/orders/routes.ts`).** `quoteToken` сверяется целиком: `subtotal`,
`discount`, `total`, `benefit.kind`, `benefit.voucherId`.

**H-03.**
- `orderGuestRoutes`: `bodyLimit` 64 КБ + zod-схемы quote/create (≤50 позиций, ≤20 модификаторов,
  ≤10 выборов, длины id ≤64).
- `/api/auth/guest`: 4 КБ + zod.
- `/api/analytics/events`: 8 КБ + zod (типизированный `meta`).

**Самопроверка.** `orders-hardening.test.ts` (9): выключенная организация → 409 `store_unavailable`;
товар выключен в точке → 409 `product_unavailable`; товар без привязки → 200; уменьшившийся кэшбэк
ломает `quoteToken` (409 `quote_stale`), свежий расчёт проходит; 100 КБ тело заказа → 413;
60 позиций → 400; 20 КБ `meta` → 413; 20 КБ тело guest-входа → 413.

---

## Дополнительно закрытые HIGH из аудита `AUDIT_6_7_COFFEE`

- **B-04** (`backend/src/modules/loyalty/receipts.ts`, `modules/sync/routes.ts`): `applyReceipts`
  принимает `ownerUserId`; гостевой `/api/sync` применяет только чеки этого гостя. Кассовый
  `/api/devices/sync` грузит чеки разных гостей и остаётся без ограничения владельца.
- **B-01** (`modules/sync/routes.ts`, `modules/devices/routes.ts`): гостевой синк — 20 запросов/мин,
  кассовый — 60 запросов/мин на устройство.

Тесты: `sync-owner-and-limit.test.ts` (3) — чужой чек отклоняется с
`receipt_belongs_to_another_user` и баланс обоих не меняется; свой применяется; 21-й запрос → 429.

---

## Что НЕ делал (и почему)

1. **B-02 (CVE в зависимостях)**: `zod`, `@hono/zod-validator`, `sharp`. Обновление `sharp` тянет
   нативную сборку — это отдельный шаг с проверкой на стенде, в «минимальный диф» не входит.
2. **B-03** (три пути начисления лояльности) — рефакторинг с высоким риском для рабочего SELL.
3. **B-05** — токен админки в `localStorage`: это `frontend-admin`, вне заявленной области.
4. **Списание по номеру карты на стороне SELL** — см. остаточный риск P0-02.
5. **Реальный E2E на терминале Эвотор и живые продажи** — нужен доступ к кабинету/кассе.
6. **APK** — другой репозиторий, не трогал.

## Важно для выкладки

1. Перед деплоем задать **все пять** критических переменных (`.env.example`), иначе процесс не
   стартует — это намеренно.
2. `EVOTOR_PROXY_TOKEN` теперь нужен и в dev: без него кассовые ручки отвечают `503`.
3. Поведение списания по телефону изменилось: сначала `POST /api/devices/customers/lookup`,
   затем `resolve` — иначе `canRedeem: false`.

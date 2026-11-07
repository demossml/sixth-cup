# Stage Report: предзаказ PWA → касса (этапы A–G)

Документ-журнал по [`PREORDER-ROLLOUT-PLAN.md`](./PREORDER-ROLLOUT-PLAN.md).
Дописывать снизу, не перезаписывать. Приёмка — [`PREORDER-UX-ACCEPTANCE.md`](./PREORDER-UX-ACCEPTANCE.md).

Дата: 07.11.2026. База: `main` после `be682ee` (модуль `orders` + корзина PWA).

---

## STAGE A — настройки на точку, ETA, авто-переходы (backend)

**Файлы**
- `backend/src/db/migrations/043_preorder_eta.sql` (+ `rollback/043_preorder_eta.sql`)
  — `preorders.eta_ready_at`, `picked_up_at`, `ready_by`; таблица `preorder_bans`.
- `backend/src/lib/preorderSettings.ts` — `preorder:<storeId>` / `preorder` в `app_settings`.
- `backend/src/modules/orders/service.ts` — `promoteIfDue`, `expireIfNeeded`, `prepMinutesForOrder`,
  `applyNoShowBan`, `activeBan`, `liftBan`, `listBans`, `transitionStatus`, `setOrderEta`, `markPickedUp`.
- `backend/src/modules/admin/routes.ts` — `GET/PATCH /api/admin/preorder/settings`.

**Что делает**
- ETA считается от правила: `max(prepMinutes точки, Σ recipe_seconds × qty / 60)`, clamp 1…120.
- `accepted → cooking` автоматически через 60 с (касса не успела — не страшно).
- `cooking → ready` по `eta_ready_at`, только при `autoReady=true` (по умолчанию включено),
  `ready_by='auto'`. При `autoReady=false` ждём кассира.
- «Принят» продлевает TTL заказа на `pickupGraceMinutes` (гость успевает дойти).
- Истечение неоплаченного заказа создаёт бан на `noShowBanHours`; бан снимается сам по времени.

**Дефолты точки:** `prepMinutes 7`, `noShowBanHours 24`, `pickupGraceMinutes 60`, `autoReady true`.

**GREEN:** `preorder-lifecycle.test.ts` зелёный, полный backend-набор зелёный.

---

## STAGE B — активный заказ, один заказ, бан (backend)

**Файлы**
- `backend/src/modules/orders/routes.ts` — `GET /api/orders/active` (объявлен **до** `/:id`),
  `POST /api/orders` с `requireAuth`, `409 active_order_exists` (+`activeOrderId`),
  `403 preorder_banned` (+`bannedUntil`), `GET /api/orders/:id` с проверкой владельца,
  `POST /api/orders/:id/received`.
- `backend/src/modules/admin/routes.ts` — `GET /api/admin/preorder/bans`,
  `POST /api/admin/preorder/bans/:userId/lift`.

**Тонкости**
- `findActiveOrderId` прогоняет кандидатов через `loadOrder`: иначе «просроченные» заказы
  висели бы активными и блокировали новые.
- `bannedUntil` считается **после** `findActiveOrderId` — иначе первый же ответ гостю врёт,
  что бана нет.
- Активным считается `draft|accepted|cooking|ready` **или** `paid` с пустым `picked_up_at`.

**GREEN:** тесты 401/409/403/lift/expiry зелёные.

---

## STAGE C — данные для кассы, ручной ETA, админ-страховка (backend)

**Файлы**
- `backend/src/modules/orders/service.ts` — резолв UUID: `storeUuidsForLocalStore`
  (через `evotor_stores.local_store_id`), `evotorUuidForProduct` (`product_store_links`);
  пишется в `preorder_items.evotor_product_uuid` и `preorder_item_modifiers.evotor_uuid`.
- `backend/src/modules/orders/routes.ts` — device-роуты под `requireDevice`:
  `GET /api/devices/orders/resolve?oid=|code=`, `GET /api/devices/orders/active`,
  `PATCH /api/devices/orders/:id/status`, `POST /api/devices/orders/:id/eta`,
  `POST /api/devices/orders/:id/reject`, `POST /api/devices/orders/:id/mark-paid`.
- `backend/src/modules/admin/routes.ts` — `GET /api/admin/preorder/orders`,
  `POST /api/admin/preorder/orders/:id/status|reject|mark-paid` (все с `admin_audit`).

**Матрица ошибок кассы:** `not_found 404`, `wrong_store 403`, `expired 410`, `already_paid 409`,
`rejected 409`, `invalid_transition 409` (тело `{ok:false, error, message}`).

**Переходы:** `draft → accepted`; `accepted → cooking | ready`; `cooking → ready`.
`accepted → ready` разрешён намеренно: кассир подтверждает готовность раньше прогноза,
ETA — прогноз, а не запрет (решение владельца).

**GREEN:** UUID в позициях (и `null` без связи), ручной ETA 1…120, админ-статусы — зелёные.

---

## STAGE D — PWA: баннер на главной + восстановление заказа (frontend)

**Файлы**
- `frontend/src/lib/preorderApi.ts` — типы `OrderOut` (+`etaReadyAt`, `etaMinutes`, `serverNow`,
  `pickedUpAt`, `readyBy`), `getActiveOrder`, `markReceived`, типизированные ошибки `createOrder`,
  `saveOrderRef/loadOrderRef/clearOrderRef` (`sc_order_current`).
- `frontend/src/lib/orderBanner.ts` + `orderBanner.test.ts` — чистая логика подписей/отсчёта.
- `frontend/src/lib/useActiveOrder.ts` — опрос 20 с, только при видимом экране; обновление на
  `visibilitychange`/`online`/`focus`; при сетевой ошибке оставляет последний статус с `offline`.
- `frontend/src/components/order/ActiveOrderBanner.tsx` — 4-сегментная шкала, акцент для
  «готов/оплачен», бейдж «без сети», `≈ сумма`, шеврон.
- `frontend/src/pages/CardPage.tsx` — баннер **первым элементом** контент-стека (до карты-пропуска),
  тап открывает `OrderQrScreen`, `onStatusChange` обновляет баннер.

**Зачем `serverNow`:** отсчёт идёт от серверного времени, а не от часов телефона.

**GREEN:** баннер не ломает титул, пустого баннера нет (`order == null → null`).

---

## STAGE E — PWA: корзина/создание с баном и «Мой заказ» (frontend)

**Файлы**
- `frontend/src/pages/MenuPage.tsx` — точка запоминается (`sc_store_id`), обработка `409`/`403`
  человеческим текстом, плашка бана с обратным отсчётом, кнопка «Собрать заказ» блокируется.
- `frontend/src/components/order/OrderQrScreen.tsx` — QR (локальный `qrcode`, payload не уходит
  третьим лицам), таймлайн 5 шагов, ETA-строка, «Я забрал заказ» для `paid`, «Отменить» для `draft`.

**Найденные и исправленные дефекты (при прогоне):**
1. Бесконечный цикл запросов в `OrderQrScreen`: эффект опроса зависел от `[orderId, order]`,
   каждый ответ пересоздавал таймер и запускал новый запрос (в живом прогоне — 63 000 запросов).
   Теперь эффект зависит только от `orderId`, терминальный статус проверяется по `ref`.
2. QR пропадал при открытии заказа из баннера в меню (`qrPayload={null}`) — теперь payload
   берётся из `sc_order_current`, как на титуле.
3. Отсчёт в баннере и в плашке бана «замирал» между опросами (20 с) — добавлен `lib/useNow.ts`.
4. Заказ менял статус на кассе, а баннер жил ещё до 20 с — `onStatusChange` из `OrderQrScreen`
   обновляет активный заказ сразу.
5. Строка «Заказ 123 · заказ 123» в статусе «Готов» — заменено на «подойдите к кассе».
6. Таймер TTL на экране заказа показывался всегда (у оплаченного — «62:15», бессмысленно) —
   теперь только для `draft`; подпись сверху зависит от статуса.

**GREEN:** ручной чеклист 0/1/2/3/4/5 состояний, бан/офлайн — без регресса титула.

---

## STAGE F — админка: «Предзаказы» + настройки (frontend-admin)

**Файлы**
- `frontend-admin/src/lib/preorder.ts` + `preorder.test.ts` — статусы, тона, `nextActions`,
  `etaText`, `etaLabel`, `banText`, `banUntilText`.
- `frontend-admin/src/pages/Preorders.tsx` — KPI (активных / ждут / готовы / всего), список
  с составом и ETA, кнопки Принять / Готовится / Готов / Оплачено / Отклонить (ConfirmDialog),
  настройки точки (prepMinutes, noShowBanHours, pickupGraceMinutes, autoReady), список банов
  со снятием.
- `frontend-admin/src/App.tsx`, `layout/Shell.tsx` — роут `/preorders`, пункт «Предзаказы», заголовок.

**Правки после живого прогона:** в строке заказа у готового/оплаченного показывался остаток ETA
(«~9 мин» у оплаченного) — введён `etaLabel(status, …)`; `nextActions` уже ожидал
`accepted → ready`, backend приведён к тому же.

**GREEN:** admin vitest зелёный, страница открывается и двигает статусы на живом backend.

---

## STAGE G — приёмка E2E (full-stack/QA)

Полный отчёт с PASS/FAIL: [`PREORDER-UX-ACCEPTANCE.md`](./PREORDER-UX-ACCEPTANCE.md).

**Что прогнано вживую** (backend в `NODE_ENV=production` на `:3964`, БД-копия, PWA + админка
на одном origin/через прокси):

| # | Сценарий | Итог |
|---|---|---|
| 1 | PWA: меню → корзина → точка → «Собрать заказ» → QR `draft` | PASS |
| 2 | Админка «Принять» → баннер «Принят · готовим · 3 минуты» | PASS |
| 3 | Авто `accepted → cooking` (сдвиг `accepted_at`) | PASS |
| 4 | Авто `cooking → ready` по ETA (`ready_by=auto`) | PASS |
| 5 | Кассир «Готов» раньше ETA (`ready_by=cashier`) | PASS (после фикса матрицы) |
| 6 | `mark-paid` → «Оплачен · назовите номер бариста» | PASS |
| 7 | «Я забрал заказ» → баннер исчезает, `picked_up_at` заполнен | PASS |
| 8 | Второй заказ → 409 → «У вас уже есть активный заказ» | PASS |
| 9 | Истечение неоплаченного → бан, плашка «доступен через 24 ч» | PASS |
| 10 | Кнопка «Собрать заказ» заблокирована на время бана | PASS |
| 11 | Снятие бана из админки → заказ снова доступен | PASS |
| 12 | Отклонение кассой → «Заказ отклонён кассой», баннер снят | PASS |
| 13 | Офлайн: «Нет сети. Показано сохранённое меню» + бейдж «без сети» на баннере | PASS |
| 14 | Чужой заказ для гостя → 404 | PASS |
| 15 | Чужая точка для кассы (`oid` и `PATCH status`) → 403 `wrong_store` | PASS |
| 16 | Касса без токена → 401 | PASS |
| 17 | Опрос экрана заказа ~5 с (не шторм запросов) | PASS |

**Тесты на момент отчёта:** backend 91 файл / 627 тестов, frontend 5 файлов / 64 теста,
frontend-admin 12 файлов / 65 тестов, `npm run typecheck` и `npm run build` — зелёные.

**Вердикт: GREEN.** Открытых блокеров нет; касса (`evotor-app`) — отдельный промпт
[`PROMPT-APK-PREORDER-QUEUE.md`](./PROMPT-APK-PREORDER-QUEUE.md), реализуется в своём репозитории.

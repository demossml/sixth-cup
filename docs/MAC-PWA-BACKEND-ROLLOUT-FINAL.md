# MAC PWA + BACKEND — итоговый отчёт наката предзаказа

Пакет: `PREORDER-PWA-SERVER.zip` (`sixth-cup-main`), промпт `PROMPT-1-MAC-PWA-BACKEND-ROLLOUT.md`.
Репозиторий: `sixth-cup`, ветка `feature/preorder-pwa-backend` (влита в `main`).

---

# Stage 0 Report — MAC PWA+BACKEND
## Status
GREEN
## What was done
- `{ROOT}` = `/Users/dmitrijsuvalov/Downloads/sixth-cup` (`package.json` + `backend/` + `frontend/` + `frontend-admin/`).
- Ветка `feature/preorder-pwa-backend` от `main` (`0f267c0`), дерево было чистым — stash не понадобился.
- Бэкап: `.preorder-backup/20261107-141147/app.ts` (каталог добавлен в `.gitignore`).
## Files changed
- `.gitignore` (+ `.preorder-backup`)
## Tests
| Test | Result |
|------|--------|
| `{ROOT}` найден | OK |
| ветка создана | OK |
| бэкап папка существует | OK |
## Decisions
- Node `v26.0.0`, npm `11.12.1` — принят как есть.
## Ready for next stage
YES

---

# Stage 1 Report — MAC PWA+BACKEND
## Status
GREEN
## What was done
- Скопированы `modules/orders/{types,service,routes}.ts`, миграция, тест.
- **Миграция переименована `040_preorder_orders.sql` → `042_preorder_orders.sql`**: `040`/`041` заняты
  (`volume_schemes`, `choice_schemes`). SQL не менялся, добавлен `rollback/042_preorder_orders_rollback.sql`.
- `app.ts`: `import { orderGuestRoutes, orderDeviceRoutes }` + `.route('/api/orders', …)`, `.route('/api/devices', …)` — без дублей.
- Роуты адаптированы к конвенциям проекта (в пакете они ждали `c.get('db'|'device'|'config')`):
  - `db` берётся из синглтона `backend/src/db`, `config` — из `backend/src/config`;
  - device-роуты закрыты штатным `requireDevice` (тот же `X-Device-Token`, что у остальных device-путей),
    точка — `c.get('storeId')`;
  - гостевые `/api/orders` используют `optionalAuth`: валидный JWT привязывает заказ к карте, отсутствие
    или протухание токена заказ не блокирует;
  - добавлен `config.orderQrSecret` (`ORDER_QR_SECRET`, фолбэк `JWT_SECRET`).
## Files changed
```
backend/src/app.ts                    |  3 +
backend/src/config.ts                 |  5 +
backend/src/modules/orders/types.ts   | new
backend/src/modules/orders/service.ts | new
backend/src/modules/orders/routes.ts  | new
backend/src/db/migrations/042_preorder_orders.sql         | new
backend/src/db/rollback/042_preorder_orders_rollback.sql  | new
backend/src/__tests__/preorder-service.test.ts            | new
```
## Tests
| Test | Result |
|------|--------|
| файлы на месте | OK |
| `app.ts` содержит оба mount без дублей | OK |
| `tsc --noEmit` (backend) | OK, без ошибок |
## Decisions
- Device middleware сохранён (не отключён, не ослаблен).
## Ready for next stage
YES

---

# Stage 2 Report — MAC PWA+BACKEND
## Status
GREEN
## What was done
- Миграция применена штатным раннером (`runMigrations` при старте `src/db/index.ts`) на копии рабочей БД.
## Tests
| Test | Result |
|------|--------|
| миграция без error | OK — `[migrate] applied 042_preorder_orders` |
| таблицы видны | OK — `preorders`, `preorder_items`, `preorder_item_modifiers` |
| данные не изменились | OK — users 4, products 9 (как до) |
## Decisions
- Проверка на копии (`/tmp/…`), рабочая БД не изменялась.
## Ready for next stage
YES

---

# Stage 3 Report — MAC PWA+BACKEND
## Status
GREEN
## What was done
- Скопированы `lib/preorderApi.ts`, `components/order/{CartSheet,OrderQrScreen}.tsx`.
- Интеграция в меню (title screen не тронут):
  - `ProductSheet`: CTA «В корзину» (кладёт выбранный размер), «На кассе покажите карту» остался второстепенным;
  - `MenuPage`: корзина в `sessionStorage`, бар «Корзина · N ≈ X ₽» над таб-баром, `CartSheet` с выбором
    кофейни (одна точка — фиксирована, несколько — селект), `Собрать заказ` → `createPreorder` → `OrderQrScreen`.
- Хост-адаптации пакета: палитра переведена на бренд (`brand`/`ink`/`line` вместо кремового `#F6F3EE`);
  QR рисуется локальным компонентом `Qr` вместо `api.qrserver.com` (payload заказа не уходит в третью сторону);
  `preorderApi` шлёт `Authorization: Bearer` (в PWA это основной способ авторизации, cookie нет).
## Files changed
```
frontend/src/lib/preorderApi.ts                      | new
frontend/src/components/order/CartSheet.tsx          | new
frontend/src/components/order/OrderQrScreen.tsx      | new
frontend/src/pages/MenuPage.tsx                      | +122
frontend/src/components/menu/ProductSheet.tsx        | +38
```
## Tests
| Test | Result |
|------|--------|
| `npm run build` (frontend) | OK |
| `git diff` по title/home (`CardPage`, `QrLayer`, `ProgressStamps`, `CardQrPage`) | пусто |
| `CartSheet`/`OrderQrScreen` в бандле | OK |
## Decisions
- Если в directory несколько точек, заказ нельзя собрать без выбора кофейни (селект в корзине).
## Ready for next stage
YES

---

# Stage 4 Report — MAC PWA+BACKEND
## Status
GREEN
## What was done
- Unit-тест сервиса, полный backend-набор, живой API-smoke и ручной прогон UI в браузере.
## Tests
| Test | Result |
|------|--------|
| `vitest preorder-service.test.ts` (better-sqlite3 уже в deps) | GREEN — 7 passed |
| backend весь набор | GREEN — 90 файлов / 611 тестов |
| frontend vitest | GREEN — 53 |
| `npm run typecheck` (3 пакета) | OK |
| smoke `POST /api/orders` | 200, `qrPayload` = `ord1.…`, `status=draft`, total = цена × qty |
| smoke `GET /api/orders/:id` | 200, `draft` |
| smoke cancel гостём | 200 |
| device без токена | 401 |
| device resolve по 6-значному коду | 200 `draft` |
| `accepted → cooking → ready` | 200 каждый |
| недопустимый переход (`ready` из `accepted`) | 409 |
| `mark-paid` | 200 `paid`; повторный resolve → 409 `already_paid` |
| заказ чужой точки | 403 `wrong_store` |
| протухший заказ | 410 при resolve, `expired` в PWA |
| заказ с Bearer JWT | `guest_user_id` заполнен, `cardId` из тела сохранён |
| регресс существующих device-роутов (`/catalog`, `/whoami`) | 200 |
| UI: меню → «В корзину» → корзина → «Собрать заказ» → QR | OK, статус обновляется опросом (ready → «Можно забирать») |
## Decisions
- Прогон UI на изолированной копии БД (`/tmp`), рабочая БД и прод не тронуты. Артефакты удалены.
## Ready for next stage
YES

---

# Stage 5 Report — MAC PWA+BACKEND
## Status
GREEN
## What was done
- Коммит в ветку `feature/preorder-pwa-backend`, push в origin, влито в `main`, push `main`.
- `docs/HANDOFF-PRODUCTION-PREORDER.md` создан, `docs/ORDER-PWA-FINAL-REPORT.md` перенесён из пакета.
## Tests
| Test | Result |
|------|--------|
| commit создан | OK |
| HANDOFF файл есть | OK |
| push ветки и main | OK |
## Decisions
- Деплой на прод в этом этапе **не выполнялся** (по правилу промпта) — инструкции в HANDOFF.
- `ORDER_QR_SECRET` не обязателен: без него подпись идёт на `JWT_SECRET`.
## Ready for next stage
YES (последний этап)

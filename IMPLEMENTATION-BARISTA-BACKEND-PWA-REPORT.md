# IMPLEMENTATION — Очередь бариста (backend + admin + web)

Серия: `PROMPTS-BARISTA-BACKEND-PWA-SEQUENTIAL.md` (STEP-0 … STEP-12).
APK-серия **не** выполнялась (см. «WHAT I DID NOT DO»).

## HEAD

- before: `00178c3` (working tree: только распакованный `AUDIT_6_7_COFFEE/` без изменений кода)
- after: те же `00178c3` + незакоммиченные изменения этой серии (commit не делал — по правилам серии)
- baseline тестов: **148 файлов / 1125 тестов** зелёные, ~22 с

## Миграции

| Файл | Что |
|------|-----|
| `backend/src/db/migrations/075_app_users.sql` | `app_users`: `login` unique COLLATE NOCASE, `password_hash`, `role CHECK(owner\|admin\|barista)`, `store_uuid`, `active`, `alert_blink`, `display_name`, `token_version`, таймстемпы |
| `backend/src/db/migrations/076_kitchen_orders.sql` | `kitchen_orders` + `UNIQUE(store_uuid, client_order_id)` + индексы `(store_uuid, status, created_at)` и `(store_uuid, created_at)` |

К `app_users` добавлены два поля сверх ТЗ:
- `token_version` — сброс пароля/отключение отзывают уже выданные JWT (иначе старый токен жил бы до 12 ч);
- `display_name` — необязательное имя для заголовка очереди (в ответе логина уже был `displayName`).

## Endpoints

| Метод | Путь | Auth | Назначение |
|-------|------|------|------------|
| POST | `/api/staff/login` | — | `{login,password}` → `{token, role, storeUuid, alertBlink, displayName}`; 401 / 403 inactive; лимит 10 попыток/15 мин на логин |
| GET | `/api/staff/me` | staff JWT | профиль |
| PATCH | `/api/staff/me` | staff JWT | `{alertBlink}` |
| GET | `/api/staff/kitchen/orders?status=active\|recent` | staff JWT | очередь точки (barista) или всех точек (owner/admin) |
| POST | `/api/staff/kitchen/orders/:id/seen` | staff JWT | `new → seen`, идемпотентно |
| POST | `/api/staff/kitchen/orders/:id/done` | staff JWT | `→ done`, однократно, push гостю |
| GET | `/api/admin/app-users` | ADMIN_TOKEN | список + роли |
| POST | `/api/admin/app-users` | ADMIN_TOKEN | создать (пароль ≥ 8, barista ⇒ storeUuid обязателен) |
| PATCH | `/api/admin/app-users/:id` | ADMIN_TOKEN | пароль/роль/точка/active/alertBlink |
| GET | `/api/admin/app-users/:id` | ADMIN_TOKEN | один пользователь |
| POST | `/api/devices/kitchen/orders` | device token / прокси Эвотора | создание заказа (контракт 4 поля в ответе) |
| GET | `/api/devices/kitchen/orders?storeUuid=&since=&windowMin=` | device token / прокси Эвотора | недавние заказы (для «готов» на кассе) |

Изоляция токенов: staff JWT подписан тем же `JWT_SECRET`, но несёт `typ: 'staff'`; гостевой
`requireAuth` такие токены отвергает, staff-middleware отвергает гостевые. `ADMIN_TOKEN` не удалён
и не менялся.

## Idempotency: yes (proof)

- `UNIQUE(store_uuid, client_order_id)` в БД + проверка до вставки.
- Тест `kitchen-orders.test.ts` → «повтор с тем же clientOrderId не создаёт второй заказ и не тратит номер»
  (`COUNT(*) = 1`, тот же `id`, тот же `queueNumber`).
- Живая симуляция против production-режима: `повтор clientOrderId → тот же заказ — 9c21a51a-…`.
- Тот же `clientOrderId` на другой точке — отдельный заказ (тест есть).
- Номер очереди идемпотентен сам по себе: `queue/numbers.issueQueueNumber` ключуется по `orderId`;
  если касса уже взяла номер (`queueOrderId`), он переиспользуется (тест «переиспользует номер…»).

## Push on done: yes

`markKitchenDone` → при `changed` и `guest_user_id` вызывает `pushToUser(...)` «Заказ №N готов».
Нет подписки/ключей VAPID → 0 отправок, ошибка глотается (канал вспомогательный).
Тест `kitchen-push.test.ts` (мок push): ровно 1 вызов с `queueNumber` в заголовке, повторный `done` не дублирует,
заказ без `guestUserId` push не шлёт.

## Barista UI

- Production экран бариста встроен в админскую сборку `frontend-admin` и доступен только на
  admin-поддомене по `/barista/`; это не требует общей Wi-Fi сети с сервером.
- На экране входа админки доступны два режима: `Токен админа` и `Логин и пароль`.
  Staff login сохраняет отдельный staff-токен и открывает экран очереди внутри admin origin.
- Отдельная legacy-сборка `frontend-barista` остаётся для dev/отдельных тестов, но production
  статикой не обслуживается на guest-домене.
- Экран: вход логин/пароль; карточки с крупным номером, составом и модификаторами, возрастом заказа;
  новое — моргание (`is-blinking`), тап → `seen` и моргание гаснет; кнопка «Исполнен» 56 px;
  переключатель «Моргание» → `PATCH /api/staff/me`; опрос 2 с + повторное обновление при возврате вкладки;
  офлайн-плашка с сохранением последнего списка; 401 → выход на форму входа.
- Portrait/landscape: одна колонка в портрете, две — в ландшафте (`@media (orientation: landscape) and (max-height: 520px)`),
  `viewport-fit=cover` + safe-area insets, кнопка «Исполнен» внутри карточки и не обрезается.
- `prefers-reduced-motion: reduce` отключает анимацию (рамка остаётся).
- Admin UI: страница «Логины» (`frontend-admin/src/pages/AppUsers.tsx`, маршрут `/app-users`, меню «Логины»):
  список, создание, выбор точки для бариста (только точки с `evotorUuid` из `/api/admin/stores`),
  active-переключатель, сброс пароля, переключатель моргания. STEP-10 закрыт здесь же.

## Simulation results

1. **Компонентная симуляция** (jsdom + @testing-library/react, `frontend-barista/src/pages/Queue.test.tsx`):
   карточка «№7» отрисована и имеет класс `is-blinking` → клик → класс снят и ушёл `POST …/seen` →
   «Исполнен» → карточка исчезла, ушёл `POST …/done`, показано «Заказов нет»; переключатель моргания шлёт PATCH `alertBlink:false`.
2. **Живая симуляция на реальном сервере** (`scripts/barista-queue-smoke.mjs`, backend в `NODE_ENV=production`):
   все 13 проверок ✓ — админ создаёт бариста, вход, 401 на неверный пароль, `me`, создание заказа (№1),
   повтор идемпотентен, бариста видит заказ, seen, done, повтор done — no-op, касса видит `done`,
   тестовый логин отключён.
3. **Статика**: на admin-host `GET /barista/` → 200 с `index.html` админской сборки, `main.tsx`
   распознаёт pathname и монтирует staff UI без HashRouter; на guest-host `/barista/` → 404.

## Tests

| Пакет | Было | Стало |
|-------|------|-------|
| backend | 148 файлов / 1125 | **152 файла / 1160** ✅ |
| frontend-admin | 35 / 332 | 35 / 332 ✅ |
| frontend | 13 / 145 | 13 / 145 ✅ |
| frontend-barista | — | **2 / 9** ✅ |

Новые backend-файлы: `staff-auth.test.ts` (11), `staff-app-users-admin.test.ts` (9),
`kitchen-orders.test.ts` (13), `kitchen-push.test.ts` (2).
`npm run typecheck` (turbo) — 5/5 задач успешно (menu-core, backend, frontend, frontend-admin, frontend-barista).
`turbo run build` — 4/4 успешно (backend, frontend, frontend-admin, frontend-barista).

Правка существующего теста: в `contract-admin-routes.test.ts` в `MOUNTS` добавлены три файла роутеров
(`staff/appUsersAdmin.ts` → `/api/admin`, `kitchen/deviceRoutes.ts` → `/api/devices`, `kitchen/staffRoutes.ts` → `/api/staff`),
иначе сканер контракта считал их пути без префикса и падал на «every admin call has a backend handler».

## WHAT I DID NOT DO

- **APK (`PROMPTS-BARISTA-APK-SEQUENTIAL.md`) — не начинал.** Исходник кассы не в этом workspace
  (в Downloads лежит `6.7-coffee-evotor-app-4.9.3.zip`). Контракт create зафиксирован в
  [docs/BARISTA-QUEUE.md](./docs/BARISTA-QUEUE.md) и готов для APK-агента.
- Loyalty earn/spend, catalog/configuration, Evotor push номенклатуры, wipe-catalog — не трогал.
- `ADMIN_TOKEN` auth не удалял и не менял.
- Ничего не коммитил и не пушил.

## Known gaps

- `in_progress` есть в схеме и в active-выборке, но ни один endpoint его не ставит — в UI он появится,
  только если появится промежуточный шаг (например, «начал готовить»). Не добавлял вне ТЗ.
- Отмены kitchen-заказа (`cancelled`) нет в API: статус в схеме есть, но кнопки/ручки нет — ТЗ не требовало.
- Экран бариста показывает только роль/логин, без названия точки (staff API не отдаёт имя точки).
- Push гостю зависит от `guestUserId`, который присылает касса. Пока APK его не шлёт, push не уходит
  (очередь и `done` работают штатно).
- Playwright-smoke не добавлял: вместо него jsdom-компонентные тесты + живая симуляция curl-скриптом
  (ТЗ допускает такую замену). Для APK-серии smoke против реальной кассы всё равно нужен.
- Rate limit логина по IP работает только при `TRUST_PROXY_HEADERS=1`; лимит по логину работает всегда.

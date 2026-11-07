# HANDOFF — предзаказ PWA → касса (production)

Ветка: `feature/preorder-pwa-backend` → влита в `main`.
Пакет: `PREORDER-PWA-SERVER.zip` (backend + PWA), накатан на текущий `main`.

**Дополнено после этапов A–G** (баннер заказа, ETA, баны, админ-страница «Предзаказы»).
Разделы 1–5 ниже описывают итоговое состояние; журнал этапов — [`PREORDER-STAGE-REPORTS.md`](./PREORDER-STAGE-REPORTS.md),
приёмка — [`PREORDER-UX-ACCEPTANCE.md`](./PREORDER-UX-ACCEPTANCE.md).

## 1. Что добавилось

| Слой | Файлы |
|---|---|
| Миграции | `042_preorder_orders.sql`, `043_preorder_eta.sql` (ETA/выдача/`preorder_bans`) + rollback-файлы |
| Backend | `backend/src/modules/orders/{types,service,routes}.ts`, `backend/src/lib/preorderSettings.ts`, монтирование в `backend/src/app.ts`, `config.orderQrSecret` |
| Админ-API | `backend/src/modules/admin/routes.ts` — блок «Предзаказы» (настройки, статусы, баны) |
| Тесты | `backend/src/__tests__/preorder-service.test.ts`, `preorder-lifecycle.test.ts` (16) |
| PWA | `frontend/src/lib/{preorderApi,orderBanner,useActiveOrder}.ts`, `frontend/src/components/order/{CartSheet,OrderQrScreen,ActiveOrderBanner}.tsx` |
| Интеграция | `frontend/src/pages/{CardPage,MenuPage}.tsx`, `frontend/src/components/menu/ProductSheet.tsx` |
| Админка | `frontend-admin/src/pages/Preorders.tsx`, `frontend-admin/src/lib/preorder.ts`, роут `/preorders` |
| Доки | `docs/ORDER-PWA-FINAL-REPORT.md`, `PREORDER-ROLLOUT-PLAN.md`, `PREORDER-STAGE-REPORTS.md`, `PREORDER-UX-ACCEPTANCE.md`, этот файл |

**Номер миграции отличается от пакета:** в архиве `040_preorder_orders.sql`, но `040` и `041` в репозитории
уже заняты (`volume_schemes`, `choice_schemes`). Содержимое SQL не менялось — только имя, чтобы миграция
применилась последней. Runtime-фолбэк `ensurePreorderTables` тоже сохранён.

## 2. Эндпоинты

| Метод | Путь | Доступ |
|---|---|---|
| POST | `/api/orders` | гость (JWT **обязателен**; `409 active_order_exists`, `403 preorder_banned`) |
| GET | `/api/orders/active` | гость (`{ok, order|null, bannedUntil}`) |
| GET | `/api/orders/:id` | гость (только свой заказ, иначе 404) |
| POST | `/api/orders/:id/cancel` | гость (только `draft`) |
| POST | `/api/orders/:id/received` | гость («я забрал», `paid|ready`) |
| GET | `/api/devices/orders/resolve?oid=|code=` | терминал (`X-Device-Token`) |
| GET | `/api/devices/orders/active` | терминал |
| PATCH | `/api/devices/orders/:id/status` | терминал (`accepted`/`cooking`/`ready`) |
| POST | `/api/devices/orders/:id/reject` | терминал |
| POST | `/api/devices/orders/:id/eta` | терминал (1…120 мин) |
| POST | `/api/devices/orders/:id/mark-paid` | терминал |
| GET/PATCH | `/api/admin/preorder/settings` | админ (`prepMinutes`, `noShowBanHours`, `pickupGraceMinutes`, `autoReady`) |
| GET | `/api/admin/preorder/orders` | админ |
| POST | `/api/admin/preorder/orders/:id/status\|reject\|mark-paid` | админ (страховка, пока касса не умеет) |
| GET | `/api/admin/preorder/bans`, `POST .../bans/:userId/lift` | админ |

Статусы: `draft → accepted → (cooking) → ready → paid`; `cancel` (только draft),
`reject` (draft|accepted|cooking), `expired` (draft TTL 30 мин, вычисляется при чтении).
`accepted → ready` разрешён: кассир подтверждает готовность раньше прогноза ETA.
При «принят» TTL продлевается на `pickupGraceMinutes`, при истечении неоплаченного заказа ставится бан.

## 3. ENV

| Переменная | Назначение |
|---|---|
| `ORDER_QR_SECRET` | HMAC для payload `ord1.*`. **Не задана — используется `JWT_SECRET`** |
| `JWT_SECRET` | уже есть; фолбэк для подписи QR |

Секреты не логируются. Если `ORDER_QR_SECRET` меняется, ранее выданные QR-коды заказов перестают
проверяться — это ожидаемо и безопасно (заказ можно найти по 6-значному коду).

## 4. Чек-лист выкладки

1. `git pull` в `/opt/sixth-cup` (или как у вас).
2. `npm ci` — lock-файл не менялся, шаг можно пропустить.
3. `npm run build` (backend + admin + frontend).
4. Перезапустить `sixth-cup-api`. При старте применятся миграции `042_preorder_orders` и `043_preorder_eta`.
5. Проверить: `sqlite3 data/sixth-cup.db "SELECT name FROM sqlite_master WHERE name LIKE 'preorder%'"` → 4 таблицы
   (три `preorder*` + `preorder_bans`).
6. Задать настройки точки в админке («Предзаказы» → «Настройки точки»): сколько готовится, бан за невыкуп,
   запас на выдачу, авто-«готов». Без этого работают дефолты 7 мин / 24 ч / 60 мин / вкл.
7. Smoke: `POST /api/orders` (с гостевой JWT) → `ok:true`, `qrPayload` начинается с `ord1.`;
   повторный `POST` → `409 active_order_exists`.
8. На терминале: резолв по 6-значному коду, смена статуса, `eta`, `mark-paid` после продажи.
9. Гость: баннер на титуле и в меню, «Я забрал заказ» после оплаты.

## 5. Ограничения (осознанно не закрыты в этом этапе)

- Цена в заказе — базовая цена товара: объёмы/молоко/добавки не пересчитываются (в пакете так же).
  Финальную сумму всё равно считает касса.
- `mark-paid` вызывает касса/бариста после продажи; PWA читает статус (опрос раз в 5 с на экране заказа,
  20 с на главной/в меню, только при видимом экране).
- В PWA нет выбора молока/добавок и схемы обязательного выбора в корзине — это делается на кассе.
- Печать талона не делалась. Касса (`evotor-app`) API заказов пока не вызывает — промпт
  [`PROMPT-APK-PREORDER-QUEUE.md`](./PROMPT-APK-PREORDER-QUEUE.md); до этого статусы двигаются из админки.
- Push «заказ готов» не сделан (P1-2): гость видит статус, пока экран открыт.

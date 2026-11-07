# HANDOFF — предзаказ PWA → касса (production)

Ветка: `feature/preorder-pwa-backend` → влита в `main`.
Пакет: `PREORDER-PWA-SERVER.zip` (backend + PWA), накатан на текущий `main`.

## 1. Что добавилось

| Слой | Файлы |
|---|---|
| Миграция | `backend/src/db/migrations/042_preorder_orders.sql` (+ `rollback/042_preorder_orders_rollback.sql`) |
| Backend | `backend/src/modules/orders/{types,service,routes}.ts`, монтирование в `backend/src/app.ts`, `config.orderQrSecret` |
| Тесты | `backend/src/__tests__/preorder-service.test.ts` (7) |
| PWA | `frontend/src/lib/preorderApi.ts`, `frontend/src/components/order/{CartSheet,OrderQrScreen}.tsx` |
| Интеграция меню | `frontend/src/pages/MenuPage.tsx`, `frontend/src/components/menu/ProductSheet.tsx` |
| Доки | `docs/ORDER-PWA-FINAL-REPORT.md`, этот файл |

**Номер миграции отличается от пакета:** в архиве `040_preorder_orders.sql`, но `040` и `041` в репозитории
уже заняты (`volume_schemes`, `choice_schemes`). Содержимое SQL не менялось — только имя, чтобы миграция
применилась последней. Runtime-фолбэк `ensurePreorderTables` тоже сохранён.

## 2. Эндпоинты

| Метод | Путь | Доступ |
|---|---|---|
| POST | `/api/orders` | гость (JWT опционален) |
| GET | `/api/orders/:id` | гость |
| POST | `/api/orders/:id/cancel` | гость (только `draft`) |
| GET | `/api/devices/orders/resolve?oid=|code=` | терминал (`X-Device-Token`) |
| GET | `/api/devices/orders/active` | терминал |
| PATCH | `/api/devices/orders/:id/status` | терминал (`accepted`/`cooking`/`ready`) |
| POST | `/api/devices/orders/:id/reject` | терминал |
| POST | `/api/devices/orders/:id/mark-paid` | терминал |

Статусы: `draft → accepted → cooking → ready → paid`; `cancel` (только draft), `reject` (draft|accepted|cooking),
`expired` (TTL 30 мин, вычисляется при чтении).

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
4. Перезапустить `sixth-cup-api`. При старте применится миграция `042_preorder_orders`.
5. Проверить: `sqlite3 data/sixth-cup.db "SELECT name FROM sqlite_master WHERE name LIKE 'preorder%'"` → 3 таблицы.
6. Smoke: `POST /api/orders` с существующим `storeId` и товаром → `ok:true`, `qrPayload` начинается с `ord1.`.
7. На терминале: резолв по 6-значному коду, смена статуса, `mark-paid` после продажи.

## 5. Ограничения (осознанно не закрыты в этом этапе)

- Цена в заказе — базовая цена товара: объёмы/молоко/добавки не пересчитываются (в пакете так же).
  Финальную сумму всё равно считает касса.
- `mark-paid` вызывает касса/бариста после продажи; PWA только читает статус (опрос раз в 5 с).
- В PWA нет выбора молока/добавок и схемы обязательного выбора в корзине — это делается на кассе.
- Печать талона и очередь на предзаказы не делались.

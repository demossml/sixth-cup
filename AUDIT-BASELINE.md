# AUDIT BASELINE — 6.7 Coffee / CXK

Этап 0 мастер-задания: инвентаризация, исходные проверки, карта архитектуры и план.
Документ фиксирует состояние **до** правок и отделяет исходные проблемы от внесённых изменений.

Дата среза: 2026-10-24. Ветка `main`, коммит `5c36548595cb3c1bf69cef85213368a57f8f48da`.

---

## 1. Окружение и исходное состояние

| Параметр | Значение |
|---|---|
| Node | v26.0.0 |
| npm | 11.12.1 |
| Рабочие пространства | `backend`, `frontend`, `frontend-admin` (npm workspaces + turbo) |
| Незакоммиченные изменения на старте | только untracked `n.md`, `n2.md`, `n3.md` (не трогались) |
| `backend` typecheck | OK |
| `frontend` typecheck | OK |
| `frontend-admin` typecheck | OK |
| `backend` build (tsup) | OK |
| `backend` tests (vitest) | **144 passed / 147, 3 failed** |

### Исходные падения тестов (до любых правок)

| Тест | Ошибка |
|---|---|
| `addon-single-entry.test.ts` → «PWA-меню клиента не показывает «Добавки»» | `expected [ 'Напитки', 'Еда', 'Другое', …(1) ] to not include 'Добавки'` |
| `poll-service.test.ts` → «enabled store: nested sc SELL is processed…» | `SqliteError: no such column: sync_enabled` |
| `poll-service.test.ts` → «SELL without sc is marked PROCESSED…» | `SqliteError: no such column: sync_enabled` |

---

## 2. Карта архитектуры

### 2.1 Backend (`backend/src`, 92 TS-файла)

Стек: Hono + better-sqlite3 + zod, сборка tsup (ESM), тесты vitest.

Точки входа: `src/index.ts` (сервер, фоновые задачи), `src/app.ts` (сборка Hono-приложения).

Монтирование маршрутов (`src/app.ts`):

```
/api/auth            modules/auth
/api/loyalty         modules/loyalty
/api/directory       modules/directory      ← публичное меню PWA
/api/sync            modules/sync
/api/devices         modules/devices (+ staff)
/api/dev             modules/dev
/api/client-logs     modules/logs
/api/admin           modules/admin           ← админка (X-Admin-Token)
/api/admin/upload    modules/upload
/api/game, /api/game/runner, /api/public, /api/analytics
```

Ключевые модули:

| Модуль | Назначение |
|---|---|
| `db/` | базовая схема, 27 SQL-миграций, bootstrap |
| `integrations/evotor/` | клиент Cloud API, синхронизация, обработка чеков, токены |
| `integrations/evotor/sync/PollService.ts` | опрос документов, обработка SELL/PAYBACK |
| `integrations/evotor/sync/ProductPushService.ts` | выгрузка товаров в Эвотор |
| `integrations/evotor/sync/AssignmentSync.ts` | привязка сотрудников/точек |
| `modules/catalog/addonScheme.ts` | модель добавок: категория, группы, схемы, каталог для кассы |
| `modules/directory/routes.ts` | публичное меню PWA |
| `modules/devices/` | каталог для кассы, добавки, продажи |
| `modules/admin/` | админ-API: товары, категории, добавки, склад, аналитика |

### 2.2 Порядок инициализации БД

```
db/index.ts:
  new Database(config.dbPath)      // WAL, foreign_keys=ON
  db.exec(SCHEMA)                  // users, cards, products(base), receipts, …
  migrateEvotorSchema(db)          // evotor_* + loyalty_ledger
  runMigrations(db)                // 001…027, учёт в schema_migrations
```

Схема распределена между тремя источниками: `db/schema.ts`, `integrations/evotor/db.ts` и `db/migrations/*.sql`. Это создаёт риск расхождений (см. дефект D4).

### 2.3 Модель добавок (на момент среза)

| Таблица | Роль |
|---|---|
| `categories` | «Добавки» — служебная категория, товары из неё не продаются напрямую |
| `products` | реальный товар добавки (цена, `category_id`, `is_group`, `parent_product_id`) |
| `modifiers` | справочник добавок; `linked_product_id` связывает с товаром |
| `modifier_schemes` | схема добавок для напитка |
| `modifier_scheme_items` | v1: схема → modifier |
| `modifier_scheme_items_v2` | v2 (миграция 025) |
| `modifier_scheme_options` | текущая модель: `kind ∈ product/zero/modifier`, `is_default`, `required`, `max_count` |
| `product_store_links` | `(product_id, store_uuid) → evotor_uuid` — UUID per-точка |
| `evotor_products` | `(product_id, variant, store_uuid) → evotor_uuid` — состояние синхронизации |

Идентификаторы: внутренний `products.id` ↔ `product_store_links.evotor_uuid` (UUID для кассы) ↔ OID каталога Эвотора. Полная инвентаризация OID / parent OID — Этап B, в этом документе не утверждается.

---

## 3. Подтверждённые дефекты этапа A

Все дефекты ниже воспроизведены в исходном состоянии и не связаны с последующими правками.

### D1. Тест писал в рабочую БД (P1, данные)

`src/__tests__/addon-single-entry.test.ts` использовал статические `import { app } from '../app'` без установки `DB_PATH`. Остальные тесты проекта задают `DB_PATH` до импорта и подключают модули динамически.

Последствия: `npm test` мутировал `backend/data/sixth-cup.db` (создавал товары, добавки, категории, связи). Доказательство: WAL-файл вырос до 2.79 МБ ровно во время прогона; в рабочей БД появились товары `Овсяное-1792861149401` и т.п.

### D2. Guard миграции 027 не работает для кириллицы (P1, данные)

```sql
WHERE NOT EXISTS (SELECT 1 FROM categories
  WHERE lower(replace(replace(name,'Ё','е'),'ё','е')) LIKE '%добавк%')
```

SQLite `lower()` складывает только ASCII. Проверено фактически:

```
lower('ДОБАВКИ')                                  → 'ДОБАВКИ'
'Добавки' LIKE '%добавк%'                         → 0
guard-выражение для 'Добавки'                     → 0
```

Последствия: миграция создаёт **вторую** категорию «Добавки» на любой базе, где категория уже заведена приложением (`ensureAddonsCategory`).

### D3. Дубли категорий утекали в меню клиента (P1, витрина)

`modules/directory/routes.ts` брал `resolveAddonsCategoryId()` — **один** id — и фильтровал по нему. Вторая «Добавки» (из D2) оставалась видимой в PWA, а её товары попадали в выдачу.

Доказательство: исходный падающий тест и живой ответ `/api/directory`, где в категориях присутствовала «Добавки».

### D4. `evotor_stores.sync_enabled` отсутствует в базовой схеме (P2, схема)

Колонка добавлялась лениво (`ALTER TABLE`) в четырёх местах: `PollService`, `index.ts`, `admin/analytics.ts` и тест `admin-console`. Свежая БД до первого такого вызова не имеет колонки → падение тестов и скрытая зависимость от порядка инициализации.

### D5. `PollService` игнорировал внедрённый клиент (P2, тестируемость)

Конструктор принимал `client = new EvotorClient()`, но `pollStore` использовал `clientForStore(...)`, а `ensureStores` — `new EvotorClient(tok)`. Параметр был мёртвым: тест `PollService(db, fakeClient)` не подменял транспорт и обращался к реальному API.

---

## 4. Риски

| Приоритет | Риск |
|---|---|
| P1 | Служебная категория «Добавки» видна покупателю; её товары попадают в меню |
| P1 | Тесты пишут в рабочую БД (риск потери/загрязнения данных, ложные результаты) |
| P1 | Дубли категорий при повторном применении миграций/бутстрапе |
| P2 | Порядок инициализации схемы определяет наличие колонок |
| P2 | Непротестированный интеграционный слой (транспорт не подменяется) |
| P2 | Схема размазана по трём источникам без единого владельца |

---

## 5. Критические бизнес-сценарии (для регрессий)

1. Покупатель открывает меню (`/api/directory`) — не видит служебных позиций.
2. Кассир получает каталог (`/api/devices/catalog`) с добавками и UUID.
3. Админ создаёт добавку → создаётся товар в «Добавки» → схема → выгрузка на точку.
4. Повторная синхронизация не создаёт дублей и не теряет связи.
5. Чек SELL с вложенным `sc` начисляет чашки один раз.
6. Изоляция точек: чужая точка не получает UUID.
7. Лояльность/QR/бонусы не ломаются изменениями каталога.

---

## 6. План исправлений

### Сделано в этапе A

| Дефект | Исправление | Проверка |
|---|---|---|
| D1 | `addon-single-entry.test.ts` переведён на изоляцию (`DB_PATH`, `KEYS_PATH`, `UPLOADS_DIR`, `ADMIN_TOKEN` + динамический импорт) | WAL рабочей БД не растёт после прогона |
| D2 | `dedupeCategoriesByName()` — схлопывание точных дублей с переносом товаров и групп; вызывается при bootstrap | новый тест + боевой лог `[migrate] collapsed 1 duplicate category` |
| D3 | `resolveAddonsCategoryIds()` + фильтрация всех категорий-добавок в `/api/directory` (и по категориям, и по товарам) | `addons-category-dedupe.test.ts` (падает на старом коде) |
| D4 | `sync_enabled` в `CREATE TABLE evotor_stores` + выравнивающий `ALTER` в `migrateEvotorSchema` | `poll-service.test.ts` |
| D5 | Внедрённый клиент реально используется в `pollStore`/`ensureStores` | `poll-service.test.ts` без сети |

### Дальше (по приоритетам)

| Приоритет | Задача | Статус |
|---|---|---|
| P0 | Проверка фискальных позиций и изоляции точек в каталоге для кассы | не начато |
| P1 | Полная инвентаризация OID / parent OID / UUID, путь добавки до кассы (`ADDONS-ARCHITECTURE-AUDIT.md`) | не начато |
| P1 | Идемпотентность импорта и выгрузки товаров | не начато |
| P2 | Единый владелец схемы БД, убрать размазанность | не начато |
| P2 | Производительность: N+1, пагинация каталога | не начато |
| P3 | Косметика и технический долг | не начато |

---

## 7. Результат после правок этапа A

```
Test Files  28 passed (28)
Tests       150 passed (150)
```

Было: `27 файлов`, `144/147`. Добавлен `addons-category-dedupe.test.ts` (3 теста).
Typecheck backend/frontend/frontend-admin — OK. Backend build — OK.

# ADDONS DATA FLOW — добавка от каталога Эвотора до чека

Трассировка по фактическому коду (не по названиям файлов). Дата: 2026-10-24, коммит `e32ba2f`.

Обозначения: ✅ проверено чтением кода и/или тестом · ⚠️ прочитано, но не проверено исполнением · ❔ не проверено

---

## Шаг 1. Эвотор отдаёт каталог

✅ `integrations/evotor/client/EvotorClient.ts` — Cloud API, авторизация `X-Authorization`, токен из `evotor_api_tokens` (`tokenStore.ts`, шифрование в `lib/crypto.ts`).

Точка входа — сервисы синхронизации, не UI.

## Шаг 2. Приложение получает группы и товары

✅ Группы и товары приходят одним списком продуктов; локально различаются флагом `products.is_group`:

```
ProductPushService.ts:54  is_group: 1 = папка, 0 = продаваемый товар
ProductPushService.ts:197 ALTER TABLE products ADD COLUMN is_group ...
```

## Шаг 3. Извлечение внешних идентификаторов и родительских связей

✅ Внешний идентификатор — **UUID**, не OID:

```
product_store_links(product_id, store_uuid) → evotor_uuid   -- PK (product_id, store_uuid)
evotor_products(product_id, variant, store_uuid) → evotor_uuid
```

✅ Родительская связь локальная: `products.parent_product_id` → товар с `is_group=1`. В Эвотор уходит как `parentUuid`:

```
ProductPushService.ts:113 parentUuidFor(db, product, storeUuid)
ProductPushService.ts:93  body.parent_id = parentUuid   (группа)
ProductPushService.ts:108 body.parent_id = parentUuid   (товар)
ProductPushService.ts:215 «Groups first so parentUuid exists before children are pushed»
```

## Шаг 4. Сопоставление товаров с локальными сущностями

⚠️ `modules/catalog/addonScheme.ts` → `syncModifierProduct(modifierId)`:

1. если `modifiers.linked_product_id` валиден — переиспользуется;
2. иначе поиск **по нормализованному имени** среди `is_group=0`:
   приоритет — товар уже в категории «Добавки», затем любой товар с `counts_as_cup=0`;
3. иначе создаётся новый товар.

Найденный товар принудительно переводится в «Добавки»:

```sql
UPDATE products SET price=?, available=?, category_id=<Добавки>,
       counts_as_cup=0, free_eligible=0, parent_product_id=<группа>, is_group=0
```

Риск: шаг 2 сопоставляет по имени, а не по идентификатору (см. AUDIT, дефект A1).

## Шаг 5. Товары категории «Добавки» импортируются/обновляются

✅ Через `syncModifierProduct` (создание) и `ProductPushService` (выгрузка). Отдельного «импорта добавок» из Эвотора нет: источник истины — админка, Эвотор получает push.

## Шаг 6. Связи с торговыми точками

✅ `product_store_links` — пер-точечная строка, PK `(product_id, store_uuid)`, `evotor_uuid` появляется после успешной выгрузки. `last_pushed_at`, `last_error`, `last_pulled_at`.

## Шаг 7. Администратор настраивает схему добавок

⚠️ `modifier_schemes` + `modifier_scheme_options`:

```sql
kind ∈ ('product','zero','modifier')
product_id → products(id) ON DELETE SET NULL
modifier_id → modifiers(id) ON DELETE CASCADE
is_default, required, max_count, group_key, sort_order
UNIQUE(scheme_id, group_key) WHERE is_default=1
```

`kind='zero'` — бесплатный вариант («Обычное молоко», «Без сиропа»), не фискальная позиция.

## Шаг 8. Backend сохраняет конфигурацию

⚠️ `POST /api/admin/modifier-schemes` принимает либо явные `options`, либо `modifierIds` из Studio. Повторное сохранение с `modifierIds` сохраняет существующие `zero`-опции (покрыто тестом `addon-single-entry.test.ts`).

## Шаг 9. Каталог устройства получает доступные опции

✅ `GET /api/devices/catalog` → `buildCatalogToppings(db, schemeId, uuidByProduct)` (`devices/routes.ts:410`).

✅ Категории «Добавки» на стороне кассы определяются функцией `devices/addons.ts:addonCategoryIds()`, которая возвращает **все** id категорий-добавок и сравнивает имена в JS, а не через SQL `LIKE` — там же явно зафиксировано, что `lower()` в SQLite не понимает кириллицу.

✅ Изоляция точек: `uuidByProduct` строится из `product_store_links` по `store_uuid`; тест «другая точка не получает чужой uuid» зелёный.

## Шаг 10. Касса показывает добавки и отправляет позиции в чек

❔ Формирование фискальных позиций (`integrations/evotor/processing/SellHandler.ts`) в рамках этапа B детально не проверялось. Продажа опции без `evotor_uuid` в этом проходе не проверялась.

---

## Сводка: что подтверждено, что нет

| Свойство из ТЗ | Статус |
|---|---|
| Товар добавки связан с локальной сущностью | ✅ `modifiers.linked_product_id` |
| Внешние идентификаторы хранятся пер-точка | ✅ `product_store_links` |
| Родительская группа | ✅ `products.parent_product_id` → `parentUuid` |
| Схема ссылается на конкретный товар | ✅ `modifier_scheme_options.product_id` |
| Схема не ссылается по имени | ⚠️ ссылки по id, но **создание связи** — по имени (A1) |
| Свои UUID у каждой точки | ✅ |
| Объёмы — отдельная логика | ✅ `product_groups` / `variant_label` |
| Группы не подменяют товары | ✅ `is_group` + фильтры |
| Импорт идемпотентен | ⚠️ частично: повторный push переиспользует `linked_product_id` |
| Касса получает только доступные опции | ⚠️ требуется проверка `available`/`required` на backend |

# Конфигурация товара для кассы — `/configuration`

Документ описывает то, что **реально работает в этом репозитории**: маршрут, формат JSON,
источники данных, диагностику и экран «Готовность кассы».

Смежные документы: [PRODUCT-CONFIGURATION-SCHEMES.md](./PRODUCT-CONFIGURATION-SCHEMES.md) (модель схем и админка),
[DEVICE-CATALOG-API.md](./DEVICE-CATALOG-API.md) (каталог), [ANDROID_INTEGRATION_CONTRACT.md](../ANDROID_INTEGRATION_CONTRACT.md).

## 1. Поток

```
Админка              Касса (APK)                        Backend
───────              ───────────                        ───────
схемы объёмов
схемы молока     тап по плитке                              GET /api/devices/products/{id}/configuration
схемы добавок  ────────────────►  ?storeUuid=…  ──────────►  volumes + milk + additions
назначение на                                                      │
карточке                                                           ▼
                                                          product_store_links точки
```

## 2. Маршрут

```http
GET /api/devices/products/{productId}/configuration?storeUuid={storeUuid}
Accept: application/json
X-Evotor-Store-Uuid: {storeUuid}[, {storeUuid2}…]
X-Evotor-Device-UUID: {deviceUuid}
```

- **Публичный read-only**, как `/catalog`: APK 5.2.21 (versionCode 147+) не передаёт `Authorization`.
  Если заголовок всё же пришёл и не совпал с `EVOTOR_PROXY_TOKEN` — `403 proxy_forbidden`.
- `X-Evotor-Store-Uuid` может содержать **список магазинов через запятую** (терминал на несколько точек).
- Точка выбирается так: `?storeUuid=` (запрос клиента), если она известна базе → иначе первая известная
  из заголовка. Понимаем и полный uuid, и короткий номер магазина (`2026` → уникальный префикс).
- `storeUuid` в ответе = значение из `?storeUuid=` (касса сверяет ответ со своим магазином);
  если расчёт шёл по другой точке, добавлен `storeUuidResolved`.
- `Cache-Control: no-store`; лимит 240 запросов в минуту на точку.

| Код | Когда |
|---|---|
| 200 | конфигурация или `{ok:false, error:"product_not_found"}` |
| 400 | `invalid_product_id`, `store_required` |
| 403 | передан неверный `Authorization` |
| 429 | больше 240 запросов в минуту |
| 404 | **не используется** — касса трактует его как «маршрута нет» |

## 3. Ответ

```json
{
  "ok": true,
  "schemaVersion": 1,
  "storeUuid": "20261017-AD69-40F0-80D2-3C027B1A4BF8",
  "productId": 5,
  "generatedAt": 1793540000,
  "volumes": [
    { "productId": 51, "evotorUuid": "CAPP-250", "name": "Капучино 250 мл", "label": "250 мл",
      "sizeValue": 250, "sizeUnit": "ml", "priceRub": 250, "available": true }
  ],
  "milk": {
    "required": true,
    "byProductId": {
      "51": { "schemeId": 7, "options": [
        { "id": 1, "productId": null, "label": "Обычное молоко", "evotorUuid": null,
          "isDefault": true, "isFree": true, "sendToReceipt": false, "sortOrder": 0,
          "available": true, "notReadyReason": null },
        { "id": 2, "productId": 900, "label": "Кокосовое молоко", "evotorUuid": "COCONUT",
          "isDefault": false, "isFree": false, "sendToReceipt": true, "sortOrder": 1,
          "available": true, "notReadyReason": null } ] },
      "52": { "schemeId": null, "options": [] }
    }
  },
  "additions": {
    "required": false,
    "byProductId": {
      "51": { "schemeId": 12, "options": [
        { "id": 21, "productId": 901, "name": "Ванильный сироп", "groupKey": "syrup",
          "evotorUuid": "VANILLA", "priceRub": 50, "required": false, "maxCount": 1,
          "isDefault": false, "zeroOption": false, "available": true, "sendToReceipt": true } ] }
    }
  },
  "configErrors": []
}
```

Правила:

| Поле | Смысл |
|---|---|
| `volumes[]` | реальные SKU группы (или один SKU); `evotorUuid` — только этой точки |
| `milk` = `null` | схема молока не назначена ни одному объёму |
| `milk.required` | `true`, если хоть у одного объёма есть назначенная схема — выбор обязателен |
| `milk.byProductId[id]` | `{schemeId: null, options: []}` = у этого объёма схемы нет |
| `milk.byProductId[id].error = "empty_scheme"` | схема назначена и активна, но вариантов нет |
| `additions` = `null` | схема добавок не назначена |
| `additions.required` | всегда `false`: кассир может не выбрать ни одной добавки |
| `configErrors[]` | **массив строк**: `links`, `milk_scheme_empty` (см. §5) |

Нулевое молоко (`isFree: true`) показывается в окне, но **не создаёт позицию в чеке**.
Платное (`sendToReceipt: true`) пробивается отдельной позицией по своему `evotorUuid`.

## 4. Откуда берутся данные

| Блок | Таблицы |
|---|---|
| Объёмы | `products` (`group_id`, `variant_label`), `product_groups`, `product_store_links` |
| Молоко | `milk_schemes`, `milk_scheme_variants`, `products.milk_scheme_id`, `product_store_links` |
| Добавки | `modifier_schemes`, `modifier_scheme_options`, `products.modifier_scheme_id` (приоритет) и `product_groups.modifier_scheme_id` |
| Схема объёмов (шаблон) | `volume_schemes`, `volume_scheme_items`, `product_volume_prices` — видна в `GET /catalog` → `product.config.volumes` |

Молоко — **отдельная сущность**, не группа добавок. Словарь групп добавок: `syrup`, `sugar`, `extra`.
Легаси-строки `group_key='milk'` переносит миграция `milkFromAddonSchemes()` при старте API.

UUID никогда не подставляется с другой точки: берётся только из `product_store_links` запрошенной точки.

## 5. `configErrors`

| Код | Что значит | Лечение |
|---|---|---|
| `links` | у объёма или платной опции нет `evotor_uuid` на этой точке | выгрузить товар на точку / привязать вручную |
| `milk_scheme_empty` | схема молока назначена и активна, но вариантов для выбора нет | добавить активный вариант или снять назначение |

Пустой массив — конфигурация полная. Коды попали в контракт: APK показывает кассиру причину.

## 6. Админка: «Готовность кассы»

Меню → вкладка **«Готовность кассы»** (`/menu?section=readiness`, страница `CatalogReadiness.tsx`).

API:

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/admin/catalog/readiness?storeUuid=` | сводка: `cards`, `readyCards`, `notReady[]` |
| GET | `/api/admin/catalog/product/:id/card?storeUuid=` | предпросмотр одной карточки так, как её увидит касса |

`notReady[]` = `{ kind: product|volume|milk|addon|volume_scheme, productId, name, reason }`,
причины — те же коды, что в `configErrors`, плюс `unavailable` (позиция выключена).
Без `storeUuid` проверяется «есть ли товар в Эвотор хоть где-то» (общий случай).

Экран показывает: сколько карточек готово, список проблем с человеческими подписями
(`frontend-admin/src/lib/readiness.ts`) и предпросмотр конфигурации выбранного напитка.

## 7. Совместимость с APK

- Старые сборки игнорируют новые поля — контракт аддитивный.
- APK 151 парсит `milk`/`additions` как `{schemeId|null, options[]}`, `configErrors` как `List<String>`.
- Пустая конфигурация (один объём, `milk: null`, `additions: null`) — обычное добавление товара в чек.
- Найденная конфигурация кэшируется на терминале (24 ч). Ошибки не кэшируются.
- После правок схем на кассе нужно очистить данные APK, иначе останется старый ответ.

## 8. Тесты

```
cd backend && DB_PATH=$(mktemp -u /tmp/fx.db) npx vitest run product-configuration
cd backend && DB_PATH=$(mktemp -u /tmp/rd.db) npx vitest run catalog-readiness
cd frontend-admin && npx vitest run readiness
```

## 9. Ограничения

- Группового наследования схемы молока нет: назначение — у каждого SKU (объёма) отдельно,
  админка проставляет его всем размерам карточки.
- Цены объёмов схемы-шаблона (`product_volume_prices`) и цены реальных SKU — разные сущности:
  конфигурация кассы отдаёт цены SKU, шаблон виден только в каталоге.
- Экран готовности считает по всем продаваемым карточкам точки: на большом каталоге запрос тяжёлый,
  кеша нет (запрос выполняется по требованию админа).

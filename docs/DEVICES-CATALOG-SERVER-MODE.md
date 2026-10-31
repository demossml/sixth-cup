# Каталог для кассы: server-режим (контракт)

`GET /api/devices/catalog?storeUuid=<uuid>` — аддитивные поля для APK ≥ 140. Старые кассы их игнорируют.

## Корень ответа

```json
{
  "ok": true,
  "storeUuid": "…",
  "features": { "serverCatalog": false },
  "notReadySummary": [{ "productId": 12, "name": "Латте", "reason": "no_store_link" }],
  "categories": [], "menu": {}, "addonCategoryIds": [], "products": [], "groups": []
}
```

- `features.serverCatalog` — включён, если пришёл `X-App-Version-Code ≥ 140` **или** query `serverCatalog=1`. По умолчанию `false`: старая касса работает по прежнему merge-пути.
- `notReadySummary` — до 50 позиций с `sellable=false` (диагностика; позиции **не** удаляются из `products[]`).

## `products[]` (новые поля)

| Поле | Значение |
|---|---|
| `sellable` | `true`, только если у товара есть непустой `evotorUuid` **этой** точки, позиция не добавка/группа и доступна |
| `notReadyReason` | `null` \| `no_store_link` (нет связи с точкой) \| `no_evotor_uuid` (связь есть, uuid пуст — например после wipe) \| `hidden_modifier` \| `unavailable` |

Витрина server-режима = `sellable && присутствует в InventoryApi терминала` (вторая часть — зона APK, причина `missing_on_terminal`).

## `toppings[]`

| Поле | Значение |
|---|---|
| `zeroOption` | UI-only опция («Обычное», «Без сиропа»): uuid не нужен, `available: true`, в чек не идёт |
| `available` | `false`, если платная опция без uuid на этой точке |
| `notReadyReason` | `null` \| `no_evotor_uuid` \| `unavailable` |

uuid добавки берётся только из `product_store_links` **запрошенной** точки; для другой точки — `null` + `available:false`.

## Проверки в коде

- сборка: `backend/src/modules/catalog/addonScheme.ts` (`buildCatalogToppings`);
- ответ: `backend/src/modules/devices/routes.ts` (`GET /catalog`);
- тесты: `backend/src/__tests__/server-catalog.test.ts` + фикстура `addons-catalog-fixture.json`.

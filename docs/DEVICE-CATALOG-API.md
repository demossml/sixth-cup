# Device catalog API (касса Эвотор)

## `GET /api/devices/catalog`

Обогащённое меню для APK: товары 6.7 + `evotorUuid`, фото, топинги, upsell, **категории**, **featured**.

**Auth:** `Authorization: Bearer <EVOTOR_PROXY_TOKEN>` (как resolve).  
**Query/header:** `storeUuid` или `X-Evotor-Store-Uuid` — фильтр availability.

### Ответ (фрагмент)

```json
{
  "ok": true,
  "generatedAt": 1710000000,
  "storeUuid": "...",
  "categories": [{ "id": 1, "name": "Напитки", "sortOrder": 0 }],
  "products": [
    {
      "id": 1,
      "productId": 1,
      "name": "Капучино",
      "price": 150,
      "priceRub": 150,
      "imageUrl": "https://app.67coffee.ru/api/devices/images/...",
      "evotorUuid": "…",
      "categoryId": 1,
      "categoryName": "Напитки",
      "featured": true,
      "countsAsCup": true,
      "freeEligible": true,
      "recipeText": "…",
      "recipe": "…",
      "description": "… #focus",
      "toppings": [{ "id": 3, "name": "Сироп", "price": 30, "priceRub": 30, "groupKey": "syrup", "maxCount": 2 }],
      "upsell": [{ "id": 9, "name": "Круассан", "price": 130, "imageUrl": "…", "evotorUuid": "…" }]
    }
  ]
}
```

`featured` true, если в description есть `#focus`/`#combo` или в названии « + ».  
На кассе: `groupName = Evotor parent || categoryName`; блок «Фокус» по `featured` (+ soft-focus).

Не путать с публичным `GET /api/directory`.


### Product image delivery through Evotor Cloud proxy

The cashier must not request `/uploads/*` directly: the Evotor URL mask is configured for
`https://app\.67coffee\.ru/api/.*`. The catalog therefore rewrites uploaded product image URLs
to `GET /api/devices/images/:file`. This endpoint validates the generated upload filename,
requires the same proxy authorization as the catalog, and streams only supported image files.
The admin UI continues to use `/uploads/*` for browser previews; stored `image_url` values do not
need to be migrated. Ensure the Evotor cabinet URL mask remains `https://app\.67coffee\.ru/api/.*`.


### Product image delivery through Evotor Cloud proxy

The cashier must not request `/uploads/*` directly: the Evotor URL mask is configured for
`https://app\.67coffee\.ru/api/.*`. The catalog therefore rewrites uploaded product image URLs
to `GET /api/devices/images/:file`. This endpoint validates the generated upload filename,
requires the same proxy authorization as the catalog, and streams only supported image files.
The admin UI continues to use `/uploads/*` for browser previews; stored `image_url` values do not
need to be migrated. Ensure the Evotor cabinet URL mask remains `https://app\.67coffee\.ru/api/.*`.

### Размеры (объёмы) — `groups[]`

Один и тот же товар в нескольких объёмах хранится как **отдельные SKU** (`products`), у каждого свой
`evotorUuid` и своя цена — на кассе это разные позиции номенклатуры. Витринная карточка живёт в
`product_groups`, поэтому каталог дополнительно отдаёт `groups`.

```json
{
  "products": [
    { "id": 12, "name": "Капучино 200 мл", "price": 200, "groupId": 5, "variantLabel": "200 мл", "variantSort": 0, "evotorUuid": "…" },
    { "id": 13, "name": "Капучино 300 мл", "price": 300, "groupId": 5, "variantLabel": "300 мл", "variantSort": 1, "evotorUuid": "…" }
  ],
  "groups": [
    {
      "id": 5,
      "name": "Капучино",
      "imageUrl": "https://app.67coffee.ru/api/devices/images/…",
      "categoryId": 1,
      "description": "…",
      "sortOrder": 0,
      "variants": [
        { "productId": 12, "evotorUuid": "…", "label": "200 мл", "price": 200, "priceRub": 200, "sizeValue": 200, "sizeUnit": "ml", "countsAsCup": true, "freeEligible": true },
        { "productId": 13, "evotorUuid": "…", "label": "300 мл", "price": 300, "priceRub": 300, "sizeValue": 300, "sizeUnit": "ml", "countsAsCup": true, "freeEligible": true }
      ]
    }
  ]
}
```

Правила для кассы:

- `groups` содержит **только** карточки с 2+ доступными вариантами. Одиночный товар (`groupId: null` или
  группа из одного размера) приходит как обычно в `products`.
- `products[]` остаётся плоским и полным — старые версии APK продолжают работать без изменений.
- Одна плитка на группу: имя/фото/категория берутся из группы, цена — у выбранного варианта.
- При добавлении позиции в чек использовать `evotorUuid` **выбранного варианта** (не группы).

## Дополнения к `GET /api/devices/catalog` (исправление для кассы)
- `products[].toppings[]` теперь всегда содержит ключ `evotorUuid` (uuid товара-добавки на точке `storeUuid`; `null`, если добавка не найдена в номенклатуре; сопоставление по имени без учёта регистра/ё/пробелов), а также `available` и `groupKey` (по умолчанию `extra`).
- Схема добавок берётся как `COALESCE(products.modifier_scheme_id, product_groups.modifier_scheme_id)` — схема, назначенная на группу размеров, действует на все варианты.
- `products[].isModifier` / `hideFromMenu` = `true` для товаров, одноимённых с добавкой («Орех», «Миндальное»). Товар остаётся в `products[]` (нужен uuid), касса скрывает плитку по флагам.
- `upsell[]` («Добавить к заказу») не содержит товаров-добавок. `countsAsCup` / `freeEligible` не менялись.


## Multi-store (несколько касс / точек)

- Касса **обязана** передавать `storeUuid` магазина Эвотора **этой** точки:
  - query: `?storeUuid=…`
  - и/или header: `X-Evotor-Store-Uuid: …`
- Если `storeUuid` задан, `products[].evotorUuid` и `toppings[].evotorUuid` берутся **только** из `product_store_links` для этой точки. Чужой магазин не подставляется. Нет link → `null`.
- Без `storeUuid` (legacy APK): берётся первый link (не рекомендуется при 2+ точках).
- Выгрузка **в облако** (`ProductPushService` / `enqueueProductSync`) идёт только на точки, где товар разрешён галочкой «На каких точках продаётся» (`product_store_links.enabled=1`). Нет строки в `product_store_links` — товар выгружается на все точки с включённой синхронизацией (обратная совместимость). `enabled=0` не удаляет уже созданную позицию и не переключает `allow_to_sell`.
- Подсказка точки: `GET /api/devices/whoami` (headers device/store) → `{ storeUuid, storeName, source }`.

## Вкладки групп на кассе — `menu`

Настраивается **по каждой кассе**: админка → **Касса** → карточка точки → **«Меню на кассе»**.
У точки может быть своя настройка; если её нет — действует общая (наследство), иначе значения
по умолчанию. Каталог отдаёт настройку той точки, чей `storeUuid` пришёл в запросе.

```json
{
  "menu": {
    "showAllTab": false,
    "order": ["Чай", "Кофе"],
    "hidden": ["Выпечка"]
  },
  "categories": [{ "id": 2, "name": "Чай", "sortOrder": 1 }]
}
```

- `menu.order` — имена групп **в порядке показа** для этой точки: свой порядок из настроек кассы,
  недостающие группы дописываются в порядке `categories.sort_order`. Группы без доступных товаров
  и скрытые на кассе сюда не попадают.
- `menu.showAllTab` — показывать ли чип «Всё». По умолчанию `true` (поведение до настройки).
- `menu.hidden` — группы, скрытые на кассе: их чип **не рисуется вообще**. Товары этих групп
  остаются в `products[]` (видны в «Всё» и поиске) — скрывается только вкладка.
- `categories` остаётся для совместимости и уже отфильтрован: скрытые на кассе группы в нём тоже нет.
- Настройка хранится в `app_settings.cashier_menu:<storeUuid>`;
  `GET /api/admin/cashier/menu?storeUuid=…`, `PATCH` (обязателен `storeUuid`, поля
  `showAllTab` / `hiddenGroups` / `order`), `DELETE ?storeUuid=…` — сброс к общей.

Правила для кассы:
1. Чипы групп рисовать в порядке `menu.order`; группы вне списка — в конце, по алфавиту,
   **кроме** имён из `menu.hidden` — для них чипа нет вовсе.
2. Чип «Всё» показывать только при `menu.showAllTab !== false`.
3. Если `menu` в ответе нет (старый backend) — прежнее поведение: «Всё» есть, группы по алфавиту.

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

# Device catalog API (касса Эвотор)

## `GET /api/devices/catalog`

Обогащённое меню для APK: товары 6.7 + `evotorUuid`, фото, топинги по схеме, upsell.

**Auth:** `Authorization: Bearer <EVOTOR_PROXY_TOKEN>` (как resolve).  
**Query/header:** `storeUuid` или `X-Evotor-Store-Uuid` — фильтр availability и предпочтение link UUID.

### Ответ (фрагмент)

```json
{
  "ok": true,
  "generatedAt": 1710000000,
  "storeUuid": "...",
  "products": [
    {
      "id": 1,
      "name": "Капучино",
      "price": 150,
      "imageUrl": "https://app.67coffee.ru/uploads/...",
      "evotorUuid": "…",
      "countsAsCup": true,
      "freeEligible": true,
      "recipeText": "…",
      "toppings": [{ "id": 3, "name": "Сироп", "price": 30, "groupKey": "syrup", "required": false, "maxCount": 2 }],
      "upsell": [{ "id": 9, "name": "Круассан", "price": 130, "imageUrl": "…", "evotorUuid": "…" }]
    }
  ]
}
```

Не путать с публичным `GET /api/directory` (PWA без рецептов/staff).

# Контракт добавок для кассы (APK)

`GET /api/devices/catalog?storeUuid=<uuid>`

Topping fields: `id`, `productId`, `name`, `price`, `priceRub`, `groupKey` (`milk`|`syrup`|`extra`),
`evotorUuid`, `required`, `maxCount`, `isDefault`, `zeroOption`, `available`.

Rules:
- Group by `groupKey`; milk/syrup = single-select; preselect `isDefault`.
- `zeroOption` → do not add receipt line.
- Paid without `evotorUuid` → disabled.
- Receipt: size variant UUID + paid toppings with UUID only.

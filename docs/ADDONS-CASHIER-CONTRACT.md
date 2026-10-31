# Контракт добавок для кассы (APK)

`GET /api/devices/catalog?storeUuid=<uuid>`

Topping fields: `id`, `productId`, `name`, `price`, `priceRub`, `groupKey` (`syrup`|`sugar`|`extra`),
`evotorUuid`, `required`, `maxCount`, `isDefault`, `zeroOption`, `available`.

**Молока в схемах добавок НЕТ.** Ключ `milk` убран из словаря групп: молоко приходит только
из `GET /api/devices/products/{id}/configuration` в блоке `milk` (см. `docs/PRODUCT-CONFIGURATION-SCHEMES.md`).
Легаси-строки `group_key='milk'` переносит миграция backend (`milkFromAddons.ts`) в отдельные схемы молока.

Rules:
- Group by `groupKey`; syrup/sugar = single-select; preselect `isDefault`.
- `zeroOption` → do not add receipt line.
- Paid without `evotorUuid` → disabled.
- **Блок добавок необязателен**: кассир может подтвердить продажу без единой добавки
  (`additions.required = false` в конфигурации карточки).
- Receipt: size variant UUID + paid toppings with UUID only.

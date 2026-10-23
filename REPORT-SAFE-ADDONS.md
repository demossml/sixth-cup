# Safe addons deploy (поверх вашего sixth-cup + APK)

## Что сделано (без выдумок, по ТЗ Claude + вашему коду)

1. **Миграция `026_addon_options.sql`** — только `modifier_scheme_options` (не конфликтует с уже применённой `025_addon_scheme_items`).
2. **`devices/addons.ts`** — как в ТЗ Claude (`addonCategoryIds`, `loadOptionsByScheme`, …).
3. **`buildCatalogToppings`** — сначала `modifier_scheme_options` (product/zero/modifier), иначе legacy `modifier_scheme_items` без name-match uuid.
4. **Admin** — импорт `resolveAddonsCategoryId`, `loadSchemeItems`, `replaceSchemeItems`, `loadSchemeOptions`, `replaceSchemeOptions`; POST схем принимает `options[]`; GET отдаёт `options`.
5. **config** — `ADDONS_CATEGORY_ID` optional.
6. **APK 4.9.11 / code 110** — isDefault/zeroOption в модели, cache, optionsFor, hide-by-name без zero (как android-патч Claude).

## Порядок выкатки

1. Бэкап БД.
2. Накатить backend-файлы → build → restart API. В логе: applied 026.
3. Категория «Добавки», товары, push на точку, схема с options (или items).
4. curl catalog?storeUuid=… — zero + uuid у платных.
5. APK assemble → терминал.

## Не смешивать

Не применять старый `addons-backend-admin.patch` целиком поверх — он ломкий на вашем дереве с 025. Этот архив уже совмещён.

# Evotor cashier: admin variants + fiscalizable toppings hotfix

## Root causes found in the two supplied archives

1. The admin API returned modifier-scheme items without `evotorUuid`. The Android cashier intentionally disables paid options that have no Evotor UUID, because a non-inventory price must not be invented or charged outside the fiscal receipt. Therefore paid toppings appeared unavailable even when the admin scheme contained them.
2. The backend already returned `groupId`, `variantLabel`, `sizeValue`, and `sizeUnit` per product, but the Android enrichment parser ignored these fields. The cashier therefore relied on `#group=` / `#size=` markers in the Evotor item description or parsing `... 350 мл` from the product name. Admin-managed variant groups were not authoritative in the cashier.

## Changes

- `/api/devices/catalog` resolves each modifier to a real product in the 6.7 product catalog by normalized exact name and returns that product's per-store Evotor UUID as `toppings[].evotorUuid`. Product names are matched case-insensitively with `ё/е` normalization and whitespace normalization.
- Android `CatalogApi` parses backend variant metadata and merges `groupId` into `variantGroup`, `sizeValue` into `sizeMl`, and `variantLabel` into the variant label fallback. Admin-defined size groups now work without manually adding description markers in Evotor.
- Existing safety rule remains: a paid topping without a linked Evotor product/UUID stays unavailable; the cashier does not create a synthetic fiscal item or apply an arbitrary price.
- Existing cart, loyalty, receipt, discount, and Evotor sell flows were not changed.

## Admin data requirement

For a paid modifier to be selectable and fiscalized, create/keep a matching product in the 6.7 product catalog, sync/link that product to the relevant Evotor store, and use the same name for the modifier and its product. Exact normalized name match is intentional to avoid silently mapping a topping to the wrong fiscal item. If names differ, rename one to match before testing.

## Verification limitation

Source-level changes are applied to both projects. Automated Android tests/build could not run in this environment because the Gradle wrapper needed to download Gradle 8.2 and outbound network access was unavailable. Run the Android build on a machine with Gradle dependencies available and verify the API response with a real store UUID before installing to the terminal.

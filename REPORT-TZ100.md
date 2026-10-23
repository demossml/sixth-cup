# REPORT — TZ addons to ~100% (Grok)

## Closed gaps vs previous agent delivery
1. **No name-match for topping UUID** in `buildCatalogToppings` — only `productId` on scheme item or `modifiers.linked_product_id`.
2. **Admin UI** (`MenuGroups.tsx`): scheme editor with product picker, zero-option, isDefault; modifiers `linkedProductId`.
3. **DELETE product → 409** if referenced by `modifier_scheme_items.product_id` or `modifiers.linked_product_id`.
4. Types: `SchemeItem` with productId / zeroOption / isDefault.
5. Migration `025_addon_scheme_items.sql` included; `addonScheme.ts` module.

## Still on you (ops)
- Create category «Добавки», products, push to store, assign scheme with productId items.
- Deploy backend + rebuild admin frontend.
- APK: use overlay from `sixth-cup-evotor-apk-addons-pay` (4.9.10) or rebuild from included sources if present.

## Not weakened
loyalty, QR, wipe-catalog, multi-token core untouched in this pass.

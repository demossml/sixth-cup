# Evotor catalog alignment (migration 027)

## Goal

Make the local catalog **1:1 with Evotor Cloud inventory**:

| Evotor field   | Local field                                      |
|----------------|--------------------------------------------------|
| `uuid`         | `product_store_links.evotor_uuid` (per store)    |
| `name`         | `products.name`                                  |
| `group`        | `products.is_group` (1 = folder, 0 = product)    |
| `parentUuid`   | resolved from `products.parent_product_id` → link |
| `type`         | `NORMAL` (products); groups pushed as folders    |
| `price`        | `products.price` (RUB)                           |
| `measure_name` | `products.measure`                               |
| `tax`          | `products.tax`                                   |
| `allow_to_sell`| `products.available` + season                    |

OID is **not** used. Cloud identity is UUID only.

## Addons model after 027

1. `modifiers` — admin/UX dictionary (name, price, group_key).
2. Each modifier has `linked_product_id` → a real `products` row in category **Добавки**.
3. That product has `parent_product_id` → a **group product** (`is_group=1`) named:
   - `Молоко` / `Сиропы` / `Сахар` / `Добавки`
4. Push order: groups first (`ORDER BY is_group DESC`), then children with `parent_id` = group’s store UUID.
5. Schemes (`modifier_scheme_items` / `modifier_scheme_options`) keep selecting which addons belong to a drink; identity on the terminal is always the linked product’s `evotor_uuid`.

## What changed in code

- Migration `027_evotor_catalog_align.sql` — columns, backfill, view `v_evotor_catalog_item`.
- `ProductPushService`: `is_group`, `parent_product_id`, `toEvotorProduct(..., parentUuid)`, groups first.
- `addonScheme.syncModifierProduct` — ensures group product + sets `parent_product_id`.

## Apply

```bash
# restart API — runMigrations applies 027 once
cd backend && npm run build && # restart process
```

Then in admin: open each modifier (or run a one-off that calls `syncModifierProduct` for all) and push catalog to the store.

## Not in this pass

- Android APK / Evotor app changes (next step).
- Dropping `modifiers` table (kept as thin layer).
- Full product-groups Cloud API (`POST /product-groups`) — groups go through the same products push with `is_group` + `parent_id` for inventories compatibility.

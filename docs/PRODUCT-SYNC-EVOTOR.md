# 6.7 ↔ Evotor catalog synchronization

## Source-of-truth model

- **Evotor Cloud** is the source of truth for Evotor-owned entities: stores, employees and the terminal-visible product UUID.
- **6.7 backend** is the source of truth for our business metadata: recipe, modifiers/toppings, cup/loyalty flags, seasonality, cost and custom JSON.
- A product in our DB has its own local `products.id`. A per-store mapping lives in `product_store_links(product_id, store_uuid, evotor_uuid)`.
- `products.evotor_uuid` is kept only as a backwards-compatible convenience for the first/legacy store link. It is not the authoritative multi-store mapping.

## Creating a new product

1. Admin creates the product in 6.7 (`catalog_source=SIXTH_CUP`).
2. Backend creates a pending `evotor_outbox` entry for every known Evotor store.
3. Sync first checks `product_store_links` and then the remote catalog by stable `article_number=sc-<our-product-id>`.
4. If the product already exists remotely (including the case where an earlier network timeout lost the CREATE response), the existing Cloud UUID is linked and no new product is created.
5. Otherwise backend calls `POST /stores/{store-id}/products` without an id. Evotor Cloud generates the product id.
6. The returned `id`/`uuid` is stored in `product_store_links` and `evotor_products`.
7. All later writes use `PUT /stores/{store-id}/products/{product-id}`. They never CREATE the same product again.

## Existing Evotor products

Catalog pull reads the real Evotor catalog and upserts by `store_uuid + evotor_uuid`.

- If a mapping exists, the same local product row is reused.
- If `article_number=sc-<id>` exists, it can repair a missing mapping.
- If `products.evotor_uuid` matches a legacy row, the mapping is repaired.
- Otherwise a local `EVOTOR_IMPORT` product is created.
- Imported products mirror Evotor base fields; 6.7 recipe/business metadata remains local.

When an admin edits an imported product in the 6.7 admin, it becomes `SIXTH_CUP` managed and is eligible for outbound synchronization.

## Product extras

The backend writes a single 6.7 ProductExtra under the Evotor product UUID. It contains:

```json
{
  "schema": "6.7.product.v1",
  "productUuid": "<Evotor UUID>",
  "countsAsCup": true,
  "freeEligible": true,
  "recipe": "espresso 18g + milk 180ml",
  "recipeCostRub": 52,
  "recipeSeconds": 90,
  "toppings": [
    { "id": 1, "name": "Ваниль", "priceRub": 30, "groupKey": "syrup" }
  ],
  "custom": { }
}
```

Changing a product, recipe or modifier scheme re-enqueues the affected product so the extra is refreshed.

## Android terminal

The 6.7 APK does **not** keep a hardcoded product catalog. Its `EvotorCatalogActivity` is registered with Evotor's `ru.evotor.createPosition` ActivityResult integration. It reads products from the terminal's local Evotor inventory, resolves a clicked UUID through `InventoryApi`, reads the `sixthcup` ProductExtra and shows recipe/topping metadata, then returns a normal `Position` to Evotor POS. Evotor remains responsible for receipt/fiscalization.

## No-duplicate invariant

```text
local Product ID + Evotor Store UUID -> exactly one Evotor product UUID
Evotor Store UUID + Evotor product UUID -> at most one local mapping
```

For a new 6.7 product the first CREATE request contains no Evotor product UUID. The response UUID is written to `product_store_links` and `evotor_products`. Every later sync for that `(store_uuid, product_id)` uses PUT with the saved UUID. If a CREATE response is lost, the next retry searches the remote catalog for `article_number=sc-<local_product_id>` before creating anything. Incoming catalog pulls upsert by `(store_uuid, evotor_uuid)`.

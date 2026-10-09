# 6.7 ↔ Evotor Cloud catalog sync

## Pipeline

`ProductPushService` is the only supported outbound writer. Local products managed by 6.7 are the source of truth; `product_store_links(product_id, store_uuid).evotor_uuid` is the authoritative, store-specific Cloud ID. `products.evotor_uuid` is legacy and is not used for writes.

A sync lists the remote v1 inventory catalog, verifies any saved link against that list, matches by `article_number=sc-{localId}` when necessary, then creates through the Cloud v2 products endpoint or replaces an existing Cloud product. A missing/stale link is recreated; the service never PUTs to a UUID that is absent from the remote list. Cloud-generated IDs are saved to links.

Product write success completes the product outbox item. Extras are an independent best-effort channel and cannot turn a successful product write into a product failure. The extras endpoint is disabled by default because production diagnostics recorded HTTP 403. Enable only after access/endpoint support is verified by setting `EVOTOR_PUSH_EXTRAS=1`; `EVOTOR_APP_ID` identifies the app. With the default `EVOTOR_PUSH_EXTRAS=0`, product recipes/modifier metadata are not sent through extras; cashier-side/local metadata remains the fallback.

## Outbox and logs

A pending task's future `next_at` is preserved by repeated enqueue. Product-write failures back off at 1, 2, 5, 15, then 60 minutes (capped). Extras failures are warnings only and do not increment product outbox attempts. Logs should identify store, product, stage and error; never log the API token.

## Admin

Use **Эвотор → Sync магазины / каталог** for a manual reconciliation. The response includes `ok`, per-store `pushed`, product-write `failed`, `extrasFailed`, and sample errors. `ok=false` / HTTP 502 means at least one product write failed; extras limitations alone do not mean product sync failed.

The wipe-catalog operation is now a selective cleanup: it deletes remote products linked to 6.7 or carrying an `sc-{id}` article number, not every SKU in the store. It then clears this store's local links and resynchronizes. Do not invoke wipe from a background tick. Review the returned listed/deleted/created/extrasFailed counts and errors.

## Polling

Document polling remains independent. Catalog work respects outbox readiness, so a pending item with future `next_at` is not pushed every poll tick. Hourly reconciliation and manual admin sync remain available.

# Fix: wipe-catalog left stale SYNCED → pushed:0

## Bug
`wipeCloudAndResync` deleted Cloud products and `product_store_links`, but left
`evotor_products` as SYNCED with old UUID. `enqueue()` then skipped every product
(`needsSync=false`), so admin showed green `{pushed:0, errors:[]}`.

## Fix
After clearing links, delete `evotor_products` (and product outbox rows) for that
store, then `pushToStore` recreates catalog in Cloud.

## Ops (no code)
Can one-shot reset a store in SQLite then run push in admin — see scripts note.

-- Emergency: force re-push for one store after wipe left stale SYNCED rows.
-- Replace STORE_UUID below with the real Bagrationa uuid (…AD69…).
-- Usage: sqlite3 backend/data/sixth-cup.db < scripts/reset-store-sync-state.sql

-- SET this:
-- .param set store 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'

-- Safer: run with explicit uuid in shell:
-- STORE='…AD69…'
-- sqlite3 db "DELETE FROM evotor_products WHERE store_uuid='$STORE' AND (variant='' OR variant IS NULL);"
-- sqlite3 db "DELETE FROM product_store_links WHERE store_uuid='$STORE';"
-- sqlite3 db "DELETE FROM evotor_outbox WHERE store_uuid='$STORE' AND entity='PRODUCT';"
-- Then in admin: push-products / sync for that store.

-- Optional: bind all stores to active token id=2 (adjust id after SELECT):
-- INSERT OR IGNORE INTO evotor_token_stores(token_id, store_uuid)
--   SELECT 2, store_uuid FROM evotor_stores;

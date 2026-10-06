-- Evotor catalog synchronization v2:
-- Cloud-generated product ids are authoritative for each store.
ALTER TABLE products ADD COLUMN catalog_source TEXT NOT NULL DEFAULT 'SIXTH_CUP';
CREATE INDEX IF NOT EXISTS idx_products_catalog_source ON products(catalog_source);

CREATE TABLE IF NOT EXISTS product_store_links (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  store_uuid TEXT NOT NULL,
  evotor_uuid TEXT,
  last_pushed_at INTEGER,
  last_error TEXT,
  PRIMARY KEY (product_id, store_uuid)
);
ALTER TABLE product_store_links ADD COLUMN last_pulled_at INTEGER;

-- Legacy releases created one link per (product,store) with deterministic UUIDs.
-- Keep the oldest row if bad legacy data already contains duplicate remote UUIDs.
DELETE FROM product_store_links
WHERE rowid NOT IN (
  SELECT MIN(rowid) FROM product_store_links
  WHERE evotor_uuid IS NOT NULL
  GROUP BY store_uuid, evotor_uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_store_links_store_evotor
  ON product_store_links(store_uuid, evotor_uuid)
  WHERE evotor_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_store_links_product ON product_store_links(product_id);

ALTER TABLE evotor_stores ADD COLUMN address TEXT;
ALTER TABLE evotor_stores ADD COLUMN code TEXT;
ALTER TABLE evotor_stores ADD COLUMN raw_json TEXT;
ALTER TABLE evotor_sync_state ADD COLUMN last_products_sync_at INTEGER;
ALTER TABLE evotor_products ADD COLUMN raw_json TEXT;

CREATE TABLE IF NOT EXISTS evotor_employees (
  employee_uuid TEXT PRIMARY KEY,
  name TEXT,
  phone TEXT,
  role TEXT,
  store_uuid TEXT,
  raw_json TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evotor_employees_store ON evotor_employees(store_uuid);

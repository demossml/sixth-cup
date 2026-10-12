-- Client/Admin leap: rich promos (CMS), per-store availability
ALTER TABLE promos ADD COLUMN image_url TEXT;
ALTER TABLE promos ADD COLUMN placement TEXT NOT NULL DEFAULT 'home';
ALTER TABLE promos ADD COLUMN status TEXT NOT NULL DEFAULT 'published';
ALTER TABLE promos ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE promos ADD COLUMN cta_label TEXT;
ALTER TABLE promos ADD COLUMN product_id INTEGER;
ALTER TABLE promos ADD COLUMN badge TEXT;
ALTER TABLE promos ADD COLUMN kind TEXT NOT NULL DEFAULT 'promo';
ALTER TABLE promos ADD COLUMN published_at INTEGER;

CREATE TABLE IF NOT EXISTS product_store_availability (
  product_id INTEGER NOT NULL,
  store_uuid TEXT NOT NULL,
  available INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (product_id, store_uuid)
);

CREATE INDEX IF NOT EXISTS idx_psa_store ON product_store_availability(store_uuid);
CREATE INDEX IF NOT EXISTS idx_promos_status_place ON promos(status, placement, starts_at, ends_at);

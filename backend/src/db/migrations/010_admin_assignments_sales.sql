-- Admin TZ: assignments enabled flag + sales lines for admin UI
ALTER TABLE product_store_links ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE product_store_links ADD COLUMN allow_to_sell_remote INTEGER NOT NULL DEFAULT 1;
ALTER TABLE product_store_links ADD COLUMN updated_at INTEGER;

CREATE TABLE IF NOT EXISTS sales_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_uuid TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  product_id INTEGER,
  evotor_product_uuid TEXT,
  name_snapshot TEXT,
  qty REAL NOT NULL DEFAULT 1,
  sum_kopecks INTEGER NOT NULL DEFAULT 0,
  closed_at INTEGER,
  UNIQUE(store_uuid, doc_id, evotor_product_uuid)
);
CREATE INDEX IF NOT EXISTS idx_sales_lines_closed ON sales_lines(closed_at);
CREATE INDEX IF NOT EXISTS idx_sales_lines_store ON sales_lines(store_uuid);

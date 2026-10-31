-- 039: Схема молока — отдельная сущность (не часть схемы добавок).
--
-- Аддитивно: новые таблицы + nullable-колонка products.milk_scheme_id.
-- Существующие товары остаются без схемы молока (автоназначения нет).
-- UUID варианта берётся из product_store_links по точке (в схеме UUID не храним).

CREATE TABLE IF NOT EXISTS milk_schemes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS milk_scheme_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scheme_id INTEGER NOT NULL REFERENCES milk_schemes(id) ON DELETE CASCADE,
  -- Локальный товар Эвотор; UUID резолвится по точке через product_store_links.
  product_id INTEGER REFERENCES products(id),
  label TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_free INTEGER NOT NULL DEFAULT 0,
  send_to_receipt INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_milk_variants_scheme ON milk_scheme_variants(scheme_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_milk_variants_product ON milk_scheme_variants(product_id);

ALTER TABLE products ADD COLUMN milk_scheme_id INTEGER REFERENCES milk_schemes(id);
CREATE INDEX IF NOT EXISTS idx_products_milk_scheme ON products(milk_scheme_id);

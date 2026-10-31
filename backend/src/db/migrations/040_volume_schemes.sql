-- 040: Схема объёмов — отдельная сущность (не группа товаров, не схема добавок).
--
-- Аддитивно: новые таблицы + nullable-колонка products.volume_scheme_id.
-- Схема задаёт набор объёмов (200 / 300 / 400 мл); цена каждого объёма — в карточке товара
-- (product_volume_prices), поэтому один и тот же шаблон годится для разных напитков.

CREATE TABLE IF NOT EXISTS volume_schemes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS volume_scheme_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scheme_id INTEGER NOT NULL REFERENCES volume_schemes(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  size_value INTEGER,
  size_unit TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

-- Цена объёма для конкретного товара; нет строки — берётся базовая цена товара.
CREATE TABLE IF NOT EXISTS product_volume_prices (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES volume_scheme_items(id) ON DELETE CASCADE,
  price INTEGER NOT NULL,
  PRIMARY KEY (product_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_volume_items_scheme ON volume_scheme_items(scheme_id, sort_order, id);
ALTER TABLE products ADD COLUMN volume_scheme_id INTEGER REFERENCES volume_schemes(id);
CREATE INDEX IF NOT EXISTS idx_products_volume_scheme ON products(volume_scheme_id);

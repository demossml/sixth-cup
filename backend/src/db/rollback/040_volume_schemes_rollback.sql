-- Ручной откат 040_volume_schemes.sql (вне папки migrations: раннер применяет все *.sql оттуда).
-- Колонка products.volume_scheme_id остаётся: SQLite не умеет безопасно откатывать ALTER ADD COLUMN
-- на старых версиях, а nullable-колонка без таблицы ни на что не влияет.
DROP TABLE IF EXISTS product_volume_prices;
DROP INDEX IF EXISTS idx_products_volume_scheme;
DROP INDEX IF EXISTS idx_volume_items_scheme;
DROP TABLE IF EXISTS volume_scheme_items;
DROP TABLE IF EXISTS volume_schemes;

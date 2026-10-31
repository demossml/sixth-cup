-- Откат 039 (выполнять вручную, не автоматически).
-- SQLite >= 3.35 поддерживает DROP COLUMN; better-sqlite3 13 несёт более новый движок.
DROP INDEX IF EXISTS idx_products_milk_scheme;
ALTER TABLE products DROP COLUMN milk_scheme_id;
DROP INDEX IF EXISTS idx_milk_variants_product;
DROP INDEX IF EXISTS idx_milk_variants_scheme;
DROP TABLE IF EXISTS milk_scheme_variants;
DROP TABLE IF EXISTS milk_schemes;

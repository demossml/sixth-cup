-- Откат 041 (выполнять вручную; SQLite ≥ 3.35 для DROP COLUMN).
DROP INDEX IF EXISTS idx_products_choice_scheme;
ALTER TABLE products DROP COLUMN choice_scheme_id;
DROP INDEX IF EXISTS idx_choice_options_scheme;
DROP TABLE IF EXISTS choice_scheme_options;
DROP TABLE IF EXISTS choice_schemes;

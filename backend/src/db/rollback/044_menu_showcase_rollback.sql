-- Откат 044: поля витрины меню и выбора кофейни. Выполнять вручную (SQLite ≥ 3.35).
DROP INDEX IF EXISTS idx_products_popular;
ALTER TABLE stores DROP COLUMN lng;
ALTER TABLE stores DROP COLUMN lat;
ALTER TABLE stores DROP COLUMN close_time;
ALTER TABLE stores DROP COLUMN open_time;
ALTER TABLE products DROP COLUMN badge;
ALTER TABLE products DROP COLUMN is_popular;
ALTER TABLE products DROP COLUMN carbs_g;
ALTER TABLE products DROP COLUMN fat_g;
ALTER TABLE products DROP COLUMN protein_g;

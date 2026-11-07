-- 044: поля для витрины меню 1:1 с макетом (Cobalt Counter) и выбора кофейни.
--
-- products:
--   protein_g / fat_g / carbs_g — КБЖУ на порцию (ккал уже есть в calories);
--   is_popular                 — попадает в блок «Популярное» на экране меню;
--   badge                      — бейдж на карточке: hit | seasonal | new (null — без бейджа).
-- stores:
--   open_time / close_time     — «08:00» / «21:00» для «Открыто · до 21:00» и запрета заказа в закрытую точку;
--   lat / lng                  — координаты для схемы и «ближайших» кофеен.
--
-- Всё аддитивно, существующие данные не меняются.

ALTER TABLE products ADD COLUMN protein_g REAL;
ALTER TABLE products ADD COLUMN fat_g REAL;
ALTER TABLE products ADD COLUMN carbs_g REAL;
ALTER TABLE products ADD COLUMN is_popular INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN badge TEXT;

ALTER TABLE stores ADD COLUMN open_time TEXT;
ALTER TABLE stores ADD COLUMN close_time TEXT;
ALTER TABLE stores ADD COLUMN lat REAL;
ALTER TABLE stores ADD COLUMN lng REAL;

CREATE INDEX IF NOT EXISTS idx_products_popular ON products(is_popular, sort_order);

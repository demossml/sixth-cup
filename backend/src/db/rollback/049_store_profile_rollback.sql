-- Откат 049: поля витрины точки и уникальная привязка к облачной точке.
DROP INDEX IF EXISTS idx_evotor_stores_local_store;
ALTER TABLE stores DROP COLUMN photo_url;
ALTER TABLE stores DROP COLUMN photo_full_url;
ALTER TABLE stores DROP COLUMN entrance_hint;
ALTER TABLE stores DROP COLUMN phone;
ALTER TABLE stores DROP COLUMN evotor_name;
ALTER TABLE stores DROP COLUMN evotor_address;

-- 049: витрина точки — фото, ориентир, телефон и снимки названия/адреса из Эвотора.
--
-- `stores` — то, что видит гость. Название и адрес владелец вводит руками (понятно клиенту:
-- «6.7 Coffee на Багратиона»), а `evotor_name` / `evotor_address` — снимки значений из облака,
-- чтобы в админке была кнопка «Взять из Эвотора». Синхронизация эти поля не перезаписывает.

ALTER TABLE stores ADD COLUMN photo_url TEXT;
ALTER TABLE stores ADD COLUMN photo_full_url TEXT;
ALTER TABLE stores ADD COLUMN entrance_hint TEXT;
ALTER TABLE stores ADD COLUMN phone TEXT;
ALTER TABLE stores ADD COLUMN evotor_name TEXT;
ALTER TABLE stores ADD COLUMN evotor_address TEXT;

-- Одна витрина ↔ одна облачная точка: иначе заказ уйдёт на чужую кассу.
CREATE UNIQUE INDEX IF NOT EXISTS idx_evotor_stores_local_store
  ON evotor_stores(local_store_id) WHERE local_store_id IS NOT NULL;

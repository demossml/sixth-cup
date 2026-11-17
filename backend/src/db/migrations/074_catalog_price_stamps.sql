-- Когда последний раз менялась цена товара или объёма — для подсказки у цены в конструкторе «Меню и Ценники».
-- products.updated_at не подходит: он меняется от любой правки карточки. Цены пишут несколько мест
-- (карточка товара, быстрая правка в таблице, синхронизация с Эвотор, добавки), поэтому отметки ставят
-- триггеры, а не код. Объёмы карточка сохраняет через «удалить все → вставить заново», поэтому отметка
-- живёт в отдельной таблице и обновляется, только если цена действительно другая.
--   key: «p:<id товара>» — цена товара; «v:<id товара>:<id объёма>» — цена объёма схемы у товара.
CREATE TABLE IF NOT EXISTS catalog_price_stamps (
  key TEXT PRIMARY KEY,
  price INTEGER NOT NULL,
  at INTEGER -- мс; NULL — цена была до появления отметок, дата неизвестна
);

-- Текущие цены — без даты: когда их ставили, неизвестно.
INSERT OR IGNORE INTO catalog_price_stamps (key, price, at)
  SELECT 'p:' || id, price, NULL FROM products;
INSERT OR IGNORE INTO catalog_price_stamps (key, price, at)
  SELECT 'v:' || product_id || ':' || item_id, price, NULL FROM product_volume_prices;

CREATE TRIGGER IF NOT EXISTS trg_price_stamp_product_ins AFTER INSERT ON products
BEGIN
  INSERT INTO catalog_price_stamps (key, price, at)
    VALUES ('p:' || NEW.id, NEW.price, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
    ON CONFLICT(key) DO UPDATE SET price = excluded.price, at = excluded.at WHERE price IS NOT excluded.price;
END;

CREATE TRIGGER IF NOT EXISTS trg_price_stamp_product_upd AFTER UPDATE OF price ON products
WHEN NEW.price IS NOT OLD.price
BEGIN
  INSERT INTO catalog_price_stamps (key, price, at)
    VALUES ('p:' || NEW.id, NEW.price, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
    ON CONFLICT(key) DO UPDATE SET price = excluded.price, at = excluded.at WHERE price IS NOT excluded.price;
END;

CREATE TRIGGER IF NOT EXISTS trg_price_stamp_volume_ins AFTER INSERT ON product_volume_prices
BEGIN
  INSERT INTO catalog_price_stamps (key, price, at)
    VALUES ('v:' || NEW.product_id || ':' || NEW.item_id, NEW.price, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
    ON CONFLICT(key) DO UPDATE SET price = excluded.price, at = excluded.at WHERE price IS NOT excluded.price;
END;

CREATE TRIGGER IF NOT EXISTS trg_price_stamp_volume_upd AFTER UPDATE OF price ON product_volume_prices
WHEN NEW.price IS NOT OLD.price
BEGIN
  INSERT INTO catalog_price_stamps (key, price, at)
    VALUES ('v:' || NEW.product_id || ':' || NEW.item_id, NEW.price, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
    ON CONFLICT(key) DO UPDATE SET price = excluded.price, at = excluded.at WHERE price IS NOT excluded.price;
END;

-- 080: способ задания цены продажи техкарты.
-- Раньше цена товара каталога всегда перекрывала цену карты, поэтому правка цены в
-- редакторе не меняла маржу. Теперь режим хранится явно, а `catalog` сохраняет
-- прежнее поведение для всех существующих карт.
ALTER TABLE tech_cards ADD COLUMN retail_mode TEXT NOT NULL DEFAULT 'catalog'
  CHECK (retail_mode IN ('catalog', 'manual', 'markup'));

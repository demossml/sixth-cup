-- 057: макет меню для гостя/типографии (отдельно от каталога и от меню кассы).
--
-- Макет — это лист (A4/A3/1:1), собранный из товаров каталога. Товары каталога макет
-- не меняет: скрытие позиции в макете не удаляет её из Меню и не влияет на кассу.
-- Содержимое лежит в doc_json (blocks связаны с product_id), оформление — в theme_json.
CREATE TABLE IF NOT EXISTS menu_layouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'a4_portrait',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready')),
  theme_json TEXT NOT NULL DEFAULT '{}',
  doc_json TEXT NOT NULL DEFAULT '{}',
  price_mode TEXT NOT NULL DEFAULT 'live' CHECK (price_mode IN ('live', 'frozen')),
  frozen_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_menu_layouts_updated ON menu_layouts(updated_at);

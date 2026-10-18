-- Размеры/объёмы товара: одна карточка в админке → N торгуемых SKU на кассе.
--
-- product_groups — витрина («Капучино»: имя, фото, категория, описание).
-- products       — по-прежнему торгуемый SKU: у каждого размера своя цена, свой
--                  evotor_uuid и своя позиция в номенклатуре Эвотор.
--
-- Товары без group_id работают как раньше (обычная одиночная позиция).

CREATE TABLE IF NOT EXISTS product_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  image_url TEXT,
  category_id INTEGER REFERENCES categories(id),
  description TEXT,
  modifier_scheme_id INTEGER,
  counts_as_cup INTEGER,
  free_eligible INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

ALTER TABLE products ADD COLUMN group_id INTEGER REFERENCES product_groups(id);
ALTER TABLE products ADD COLUMN variant_label TEXT;
ALTER TABLE products ADD COLUMN variant_sort INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_products_group ON products(group_id);
CREATE INDEX IF NOT EXISTS idx_product_groups_cat ON product_groups(category_id);

-- Откат 042: предзаказы PWA (гость → касса). Выполнять вручную.
DROP INDEX IF EXISTS idx_preorder_mods_item;
DROP TABLE IF EXISTS preorder_item_modifiers;
DROP INDEX IF EXISTS idx_preorder_items_order;
DROP TABLE IF EXISTS preorder_items;
DROP INDEX IF EXISTS idx_preorders_expires;
DROP INDEX IF EXISTS idx_preorders_short;
DROP INDEX IF EXISTS idx_preorders_store_status;
DROP TABLE IF EXISTS preorders;

-- Откат 062: возвращаем себестоимость на старые таблицы cost_*.
-- Колонки stock_items (weight_per_pc_kg и пр.) остаются: они аддитивные и не мешают.

DROP TABLE IF EXISTS tech_card_lines;
DROP TABLE IF EXISTS tech_card_versions;
DROP TABLE IF EXISTS tech_cards;
DROP TABLE IF EXISTS stock_item_cost_history;
DROP INDEX IF EXISTS idx_tech_cards_kind;
DROP INDEX IF EXISTS idx_tech_cards_product;
DROP INDEX IF EXISTS idx_tcv_card;
DROP INDEX IF EXISTS idx_tcl_version;
DROP INDEX IF EXISTS idx_tcl_item;
DROP INDEX IF EXISTS idx_tcl_child;
DROP INDEX IF EXISTS idx_cost_history_item;

UPDATE cost_recipes SET migrated_card_id = NULL;

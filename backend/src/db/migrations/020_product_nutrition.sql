-- Вес/объём порции и калорийность — для витрины меню (необязательные).
-- size_unit: 'g' (граммы) | 'ml' (миллилитры). calories — ккал на порцию.
ALTER TABLE products ADD COLUMN size_value INTEGER;
ALTER TABLE products ADD COLUMN size_unit TEXT;
ALTER TABLE products ADD COLUMN calories INTEGER;

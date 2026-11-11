-- Откат F16: убираем веса, оставляем прежние штуки.
UPDATE cost_sales_plan SET units_per_month = weight WHERE weight > 0;
ALTER TABLE cost_sales_plan DROP COLUMN weight;

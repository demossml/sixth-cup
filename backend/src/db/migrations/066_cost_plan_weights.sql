-- F16: веса популярности вместо точных штук.
-- Владелец ставит ползунок «насколько эта позиция продаётся чаще других», а штуки
-- считаются из них: units = общий план × вес / сумма весов.
ALTER TABLE cost_sales_plan ADD COLUMN weight REAL NOT NULL DEFAULT 0;

-- Старые значения (штуки) переносим в веса: пропорции сохраняются, сумма берётся из общего плана.
UPDATE cost_sales_plan SET weight = units_per_month WHERE weight = 0 AND units_per_month > 0;

-- F15: план продаж по позициям — чтобы постоянные расходы раскладывались по структуре продаж,
-- а не «поровну на всё меню» (100 кружек плана не должны давать 2 500 ₽ аренды в каждую чашку).
CREATE TABLE IF NOT EXISTS cost_sales_plan (
  card_id INTEGER PRIMARY KEY REFERENCES tech_cards(id) ON DELETE CASCADE,
  units_per_month REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_cost_sales_plan_units ON cost_sales_plan(units_per_month);

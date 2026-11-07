-- 043: ETA предзаказа, факт выдачи и баны за невыкуп.
--
-- Аддитивно: preorders.eta_ready_at (когда будет готов), picked_up_at (гость забрал),
-- ready_by ('auto' | 'cashier') и таблица preorder_bans.
-- Настройки «сколько готовится» и «на сколько банить» живут в app_settings:
--   preorder            — общая настройка
--   preorder:<storeId>  — настройка конкретной точки

ALTER TABLE preorders ADD COLUMN eta_ready_at INTEGER;
ALTER TABLE preorders ADD COLUMN picked_up_at INTEGER;
ALTER TABLE preorders ADD COLUMN ready_by TEXT;

CREATE TABLE IF NOT EXISTS preorder_bans (
  user_id INTEGER PRIMARY KEY,
  until INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT 'no_show',
  order_id TEXT,
  created_at INTEGER NOT NULL,
  lifted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_preorder_bans_until ON preorder_bans(until);

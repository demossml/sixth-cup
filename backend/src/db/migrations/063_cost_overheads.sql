-- 063: постоянные расходы (электричество, зарплата, аренда, налоги) и их распределение на порцию.
-- Смысл: владелец знает суммы за месяц; система раскидывает их на проданные позиции,
-- чтобы показывать не только «сырьевую» себестоимость, но и полную.

CREATE TABLE IF NOT EXISTS cost_overheads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('electricity', 'salary', 'rent', 'tax', 'other')),
  amount_kop INTEGER NOT NULL DEFAULT 0 CHECK (amount_kop >= 0),
  /** Период суммы: сейчас всегда месяц, поле оставлено на будущее (квартал/год). */
  period TEXT NOT NULL DEFAULT 'month' CHECK (period IN ('month', 'quarter', 'year')),
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO cost_overheads (name, kind, amount_kop, active, sort_order, created_at, updated_at)
SELECT * FROM (
  SELECT 'Электричество' AS name, 'electricity' AS kind, 0 AS amount_kop, 1 AS active, 10 AS sort_order,
         CAST(strftime('%s','now') AS INTEGER) * 1000 AS created_at, CAST(strftime('%s','now') AS INTEGER) * 1000 AS updated_at
  UNION ALL SELECT 'Зарплата', 'salary', 0, 1, 20, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
  UNION ALL SELECT 'Аренда', 'rent', 0, 1, 30, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
  UNION ALL SELECT 'Налоги', 'tax', 0, 1, 40, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
) WHERE NOT EXISTS (SELECT 1 FROM cost_overheads);

CREATE TABLE IF NOT EXISTS cost_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO cost_settings (key, value) VALUES
  -- units — на проданную единицу (по умолчанию), revenue — пропорционально выручке позиции
  ('overhead_allocation', 'units'),
  -- запасной объём, если продаж в базе ещё нет
  ('planned_units_per_month', '0'),
  -- окно, за которое берём продажи для распределения
  ('overhead_window_days', '30');

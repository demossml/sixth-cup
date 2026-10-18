-- Staff schedule / timesheet / wishes / breaks for Evotor cashier shift UI.
-- Additive only; empty tables = empty API responses (no demo data).

CREATE TABLE IF NOT EXISTS staff_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER REFERENCES stores(id),
  store_uuid TEXT,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Кассир',
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_staff_store ON staff_members(store_id);
CREATE INDEX IF NOT EXISTS idx_staff_store_uuid ON staff_members(store_uuid);

CREATE TABLE IF NOT EXISTS staff_schedule_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'work',
  start_hm TEXT,
  end_hm TEXT,
  label TEXT,
  UNIQUE(staff_id, day)
);
CREATE INDEX IF NOT EXISTS idx_schedule_day ON staff_schedule_days(day);

CREATE TABLE IF NOT EXISTS staff_wish_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER REFERENCES stores(id),
  store_uuid TEXT,
  target_month TEXT NOT NULL,
  period_label TEXT,
  closes_label TEXT,
  limit_days INTEGER NOT NULL DEFAULT 3,
  can_edit INTEGER NOT NULL DEFAULT 1,
  UNIQUE(store_id, target_month)
);

CREATE TABLE IF NOT EXISTS staff_wishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  target_month TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  selected_json TEXT NOT NULL DEFAULT '[]',
  accepted_json TEXT NOT NULL DEFAULT '[]',
  declined_json TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL,
  UNIQUE(staff_id, target_month)
);

CREATE TABLE IF NOT EXISTS staff_breaks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'none',
  rec_start TEXT,
  rec_end TEXT,
  rec_hint TEXT,
  actual_start TEXT,
  actual_end TEXT,
  actual_minutes INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE(staff_id, day)
);

CREATE TABLE IF NOT EXISTS staff_device_link (
  device_uuid TEXT PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  updated_at INTEGER NOT NULL
);

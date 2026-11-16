-- BONUS-LOYALTY (SEO: вариант B): бонусный кэшбэк в процентах вместо «5 чашек — подарок».
--
-- Глобальный процент начисления и индивидуальный процент на клиента (priority: individual,
-- NULL = наследовать глобальный). Кэшбэк — в копейках, проценты — в basis points (bps):
-- 500 bps = 5.00 %. Целое число bps избавляет от плавающей точки в деньгах.
CREATE TABLE IF NOT EXISTS loyalty_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  earn_percent_bps INTEGER NOT NULL DEFAULT 500,
  updated_at INTEGER,
  updated_by TEXT
);

INSERT OR IGNORE INTO loyalty_settings(id, earn_percent_bps, updated_at, updated_by)
VALUES (1, 500, NULL, NULL);

-- Индивидуальный процент: NULL — наследовать глобальный.
ALTER TABLE users ADD COLUMN bonus_percent_bps INTEGER;
-- Согласие на обработку персональных данных при регистрации по телефону.
ALTER TABLE users ADD COLUMN pd_consent_at INTEGER;
ALTER TABLE users ADD COLUMN pd_consent_version TEXT;
-- Когда к карте привязан настоящий телефон (а не псевдо-значение 'guest:<hex>').
ALTER TABLE users ADD COLUMN phone_bound_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_users_phone_bound ON users(phone_bound_at);

-- История изменений индивидуального процента: кто, когда, было/стало.
CREATE TABLE IF NOT EXISTS bonus_percent_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  old_bps INTEGER,
  new_bps INTEGER,
  at INTEGER NOT NULL,
  admin TEXT
);

CREATE INDEX IF NOT EXISTS idx_bonus_percent_audit_user ON bonus_percent_audit(user_id, at);

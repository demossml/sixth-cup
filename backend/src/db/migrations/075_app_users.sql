-- Пользователи приложения (сотрудники): login + password, роли owner/admin/barista.
--
-- Отдельная таблица, а не `users`/`staff_members`:
--   • `users` — гости PWA (телефон/бонусы), вход по QR-карте;
--   • `staff_members` — смены, графики, пожелания (без пароля);
--   • `app_users` — учётные записи для входа в интерфейс бариста и админку.
--
-- Пароль хранится только хэшем (scrypt, см. modules/staff/password.ts), открытый текст нигде не пишется.
-- `token_version` — отзыв выданных токенов: сброс пароля инкрементирует версию, старые JWT перестают работать.
CREATE TABLE IF NOT EXISTS app_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','barista')),
  store_uuid TEXT NULL,                    -- бариста: своя точка; NULL = все точки (только owner/admin)
  active INTEGER NOT NULL DEFAULT 1,
  alert_blink INTEGER NOT NULL DEFAULT 1,  -- моргание новых заказов в UI бариста
  display_name TEXT NULL,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Бариста всегда фильтруется по точке — индекс под выборку «кто на точке».
CREATE INDEX IF NOT EXISTS idx_app_users_store ON app_users(store_uuid, active);

-- 053: один активный заказ на гостя + ключ идемпотентности (P1-3).
--
-- Проверка «есть ли активный заказ» перед вставкой не атомарна: два параллельных запроса
-- проходили её одновременно и создавали два заказа. Уникальный частичный индекс закрывает гонку.

CREATE UNIQUE INDEX IF NOT EXISTS idx_preorders_one_active_per_guest
  ON preorders(guest_user_id)
  WHERE guest_user_id IS NOT NULL AND status IN ('draft','accepted','cooking','ready');

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  user_id INTEGER,
  result_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency_keys(created_at);

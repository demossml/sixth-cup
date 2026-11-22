-- Очередь бариста: заказы с кассы (источник A — APK создаёт заказ сам после ухода в sell).
--
-- Идемпотентность: касса может повторить POST при обрыве сети. Ключ повтора — `client_order_id`
-- от APK, уникальный в рамках точки: повтор возвращает существующую строку, второй заказ не появляется.
-- Номер очереди берётся из общего модуля queue_numbers (тот же счётчик, что печатает чек).
CREATE TABLE IF NOT EXISTS kitchen_orders (
  id TEXT PRIMARY KEY,                    -- uuid заказа очереди
  store_uuid TEXT NOT NULL,
  queue_number INTEGER,                   -- из queue_numbers.number
  queue_order_id TEXT,                    -- queue_numbers.order_id
  client_order_id TEXT NOT NULL,          -- idempotency key с кассы
  status TEXT NOT NULL CHECK (status IN ('new','seen','in_progress','done','cancelled')),
  source TEXT NOT NULL DEFAULT 'cashier',
  items_json TEXT NOT NULL,               -- [{ name, qty, mods: string[], note: string|null }]
  guest_user_id INTEGER NULL,
  card_code_mask TEXT NULL,
  total_kopecks INTEGER NULL,
  evotor_doc_id TEXT NULL,
  created_at INTEGER NOT NULL,
  seen_at INTEGER NULL,
  done_at INTEGER NULL,
  done_by_user_id INTEGER NULL,
  UNIQUE (store_uuid, client_order_id)
);

-- Основной запрос бариста: активные заказы точки по времени создания.
CREATE INDEX IF NOT EXISTS idx_kitchen_orders_active ON kitchen_orders(store_uuid, status, created_at);
-- Экран кассы: недавние заказы точки (включая done), чтобы показать «готов».
CREATE INDEX IF NOT EXISTS idx_kitchen_orders_store_created ON kitchen_orders(store_uuid, created_at);

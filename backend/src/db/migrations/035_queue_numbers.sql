-- Публичный номер заказа (Queue Number) на чеке. Не фискальный реквизит:
-- живёт отдельно от receipts/evotor_docs и никогда не подменяет номер ФД.
-- Правило периода — календарный день точки (см. modules/queue/numbers.ts).
CREATE TABLE IF NOT EXISTS queue_numbers (
  order_id TEXT PRIMARY KEY,
  store_uuid TEXT NOT NULL,
  period_key TEXT NOT NULL,
  number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ISSUED',
  evotor_document_uuid TEXT,
  fiscal_document_number TEXT,
  created_at INTEGER NOT NULL,
  bound_at INTEGER,
  cancelled_at INTEGER,
  expires_at INTEGER
);

-- Уникальность номера в пределах точки и периода: гонки двух касс разводит сам SQLite.
CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_numbers_unique
  ON queue_numbers(store_uuid, period_key, number);

CREATE INDEX IF NOT EXISTS idx_queue_numbers_active
  ON queue_numbers(store_uuid, period_key, status);

-- Счётчик выдачи: атомарный инкремент RETURNING, без чтения-записи в два шага.
CREATE TABLE IF NOT EXISTS queue_counters (
  store_uuid TEXT NOT NULL,
  period_key TEXT NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (store_uuid, period_key)
);

-- Привязка документа Эвотора к заказу приходит из poll — ищем по uuid.
CREATE INDEX IF NOT EXISTS idx_queue_numbers_doc
  ON queue_numbers(evotor_document_uuid);

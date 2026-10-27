-- Повторная обработка упавших документов Эвотора (L-07).
-- Статус остаётся 'FAILED' (CHECK в таблице неизменяем), различие — в next_retry_at:
--   next_retry_at IS NOT NULL  → документ в очереди на повтор
--   next_retry_at IS NULL      → окончательный отказ (исчерпаны попытки или ошибка данных)
ALTER TABLE evotor_docs ADD COLUMN next_retry_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_evotor_docs_retry ON evotor_docs(status, next_retry_at);

-- Конструктор «Меню и Ценники»: подробности каждой отправки в типографию — копии отправленных
-- документов, что в них изменилось, текст письма. Отдельно от poster_workspace: копии листов большие,
-- а нужны только в истории отправок.
CREATE TABLE IF NOT EXISTS poster_send_details (
  send_id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_poster_send_details_at ON poster_send_details(at);

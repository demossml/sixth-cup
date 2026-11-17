-- Конструктор «Меню и Ценники»: всё состояние — один JSON-документ (меню, ценники, кафе,
-- получатели, отправки, журнал). Одна строка; rev — версия для условной записи (две вкладки
-- не затрут правки друг друга). Цены строк, привязанных к каталогу, сервер сверяет с products.
CREATE TABLE IF NOT EXISTS poster_workspace (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL,
  rev INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Откат 047: медиа товара. Выполнять вручную (SQLite ≥ 3.35).
ALTER TABLE products DROP COLUMN poster_url;
ALTER TABLE products DROP COLUMN video_url;
ALTER TABLE products DROP COLUMN media_type;

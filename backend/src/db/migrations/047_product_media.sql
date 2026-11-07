-- 047: медиа товара — фото ИЛИ видео (то, что загружают в админке), с постером для сетки.
--
-- image_url остаётся основным полем фото (обратная совместимость).
-- Для видео: video_url + poster_url (кадр-обложка, его показываем в списке, чтобы не грузить видео).

ALTER TABLE products ADD COLUMN media_type TEXT NOT NULL DEFAULT 'image';
ALTER TABLE products ADD COLUMN video_url TEXT;
ALTER TABLE products ADD COLUMN poster_url TEXT;

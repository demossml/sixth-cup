-- Promo media can be an image or a short video. Existing rows remain images.
ALTER TABLE promos ADD COLUMN media_type TEXT NOT NULL DEFAULT 'image';

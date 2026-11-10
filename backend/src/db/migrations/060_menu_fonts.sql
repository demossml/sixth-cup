-- 060: свои шрифты для макета меню.
--
-- Владелец загружает TTF/OTF/WOFF, файл проверяется на кириллицу и знак ₽.
-- Файлы лежат в uploads, поэтому @font-face в админке и PDFKit на сервере
-- берут один и тот же файл: холст и печать совпадают.
CREATE TABLE IF NOT EXISTS menu_fonts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family TEXT NOT NULL,
  regular_key TEXT NOT NULL,
  bold_key TEXT,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_menu_fonts_family ON menu_fonts(family);

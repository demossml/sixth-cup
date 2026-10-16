# Доставка фото кассы через прокси Эвотора

- Добавлен защищённый `GET /api/devices/images/:file` в namespace `/api/devices/*`.
- `/api/devices/catalog` теперь возвращает проксируемые URL для загруженных локальных изображений.
- Существующие значения `products.image_url` и маршруты `/uploads/*` для админки не изменены.
- Endpoint использует `evotorProxyStrict`, проверяет имя файла и отдаёт только JPEG/PNG/WebP до лимита загрузки.
- В `docs/DEVICE-CATALOG-API.md` и `docs/EVOTOR-PROXY-STAGE1.md` описан контракт и маска URL.

# Идентификаторы опций молока и добавок

1. В `GET /api/devices/products/:id/configuration` `id` у `milk.byProductId[*].options[]` — это `milk_scheme_variants.id`;
   `id` у `additions.byProductId[*].options[]` — id опции схемы добавок (`modifier_scheme_options`). Пространства **пересекаются**:
   использовать `id` как общий ключ нельзя. Формат ответа не менялся.
2. Касса помечает строки молока флагом `fromMilkScheme` (ключ опции `c:m:<id>`) и не сверяет их с добавками каталога
   (APK 5.2.32, `ReceiptValidator`).
3. Защита от неверной привязки: `POST /api/admin/milk-schemes` возвращает `warnings` (сохранение не блокируется),
   `GET /api/admin/milk-schemes/audit` — список расхождений по всем схемам.
4. Правило «название варианта ↔ товар» (`milkLabelMatches` в `modules/catalog/milkScheme.ts`, зеркало в `frontend-admin/src/lib/milkScheme.ts`):
   слова приводятся к нижнему регистру, «ё»→«е», убираются «молоко/молочко/milk» и слова короче 3 букв, остаётся основа из 4 букв;
   совпадение хотя бы одной основы = названия согласованы; если сравнивать нечего — предупреждения нет.
5. Проверка данных (read-only) и исправление через админку:
   - `SELECT v.id, v.scheme_id, v.label, v.product_id, p.name FROM milk_scheme_variants v LEFT JOIN products p ON p.id=v.product_id WHERE v.send_to_receipt=1 AND v.active=1;`
   - `SELECT o.id, o.group_key, o.product_id FROM modifier_scheme_options o WHERE o.id IN (SELECT id FROM milk_scheme_variants WHERE send_to_receipt=1);`
   - Исправление: Меню → Молоко → схема → у «Кокосовое молоко» выбрать товар «Молоко кокосовое» → Сохранить.

# Admin redesign — база Claude + pass проверки

## Источник
Архив Claude: полный редизайн админки (фазы 0–3), UI-kit, console API, audit, тесты.

## Что НЕ меняли
- Shell, kit, страницы, визуальный стиль
- Логику SellHandler / Poll / loyalty
- Android, client PWA

## Что добавлено в pass (минимально)
1. **Карточка товара (Drawer):** поля «Рецепт», «URL фото», загрузка файла на `/api/admin/upload`, себестоимость и время приготовления в блоке «Дополнительно» — данные уже уходили в `POST /products`, в форме не хватало ввода.
2. Документы установки: `AGENT-APPLY-ADMIN.md` (MacBook + Mac mini).

## Уже было у Claude (проверено, без правок)
- HashRouter, 7 разделов + `#/legacy`
- SQL health через `evotor_sync_state.status` (не ломает прод)
- `ADMIN_ALLOW_RESET`, timingSafeEqual, audit
- Bulk dryRun, CSV, wipe/drift на Кассе
- Customer card: кэшбэк, рефералы, телефон по запросу

## Намеренно не делали
- Роли (фаза 4)
- Retry SELL из UI

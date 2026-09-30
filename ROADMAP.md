# Roadmap

## ✅ Этап 1 Backend foundation
Organizations, stores.organization_id, tax, categories, products+, upload, migrations, directory.

## ✅ Этап 2 Admin UI + PWA menu
Admin tabs, product photo upload, menu categories/images.

## ⬜ Этап 3 Android cashier app
- Package `ru.sixthcup.evotor`
- Enroll via `POST /api/devices/enroll`
- Cache `GET /api/directory`
- Menu UI offline
- Не путать loyalty QR-поток PWA CashierPage с фискальной продажей

## ⬜ Этап 4 Evotor SDK
- OpenSellReceiptCommand + payment navigation
- Позиции с priceWithDiscountPosition (loyalty)
- Без QR клиенту после оплаты

## ⬜ Этап 5 Fiscal analytics
- Webhook/API облака Эвотор → backend sales
- Admin отчёты по выручке (не только loyalty receipts)

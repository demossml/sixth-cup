# Evotor Phase 0/1

## Уже подтверждено на реальном API

- v1 inventories;
- `X-Authorization`;
- даты `YYYY-MM-DD`;
- `ltCloseDate` исключительная;
- `transactions[]` в SELL;
- PAYBACK содержит `baseDocumentUUID`;
- два магазина из тестового аккаунта отвечают 402 из-за установки/оплаты приложения.

## Реализовано после Phase 0

- автоматический polling 60 секунд;
- часовая и суточная сверка;
- обработка SELL/PAYBACK с идемпотентностью;
- loyalty ledger;
- disputes;
- deterministic UUIDv5 для товаров;
- outbox товаров;
- product extras;
- сезонность;
- signed card QR v2;
- отсутствие SMS и числового публичного card code.

## Осталось проверить физически

**Phase 0.6:** установить APK, выполнить реальную продажу с QR и убедиться, что `extras.sc` появляется в документе Cloud API.

Без этой проверки нельзя считать loyalty→Evotor→Cloud канал доказанным.

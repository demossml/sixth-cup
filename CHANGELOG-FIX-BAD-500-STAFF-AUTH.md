# Fix: bad() 500 + staff device auth

## 1. backend/src/lib/errors.ts
- Добавлен статус **500** в union `bad()`.
- Устраняет падение `tsc` монорепо/PWA: `bad('Cannot decrypt token', 500)` в `evotorTokens.ts`.

## 2. staff/deviceRoutes.ts
- Все staff device routes: `evotorProxy` (как остальные devices).
- Мутации (PUT wishes, POST breaks start/end): `evotorProxyStrict`.
- GET summary/team/timesheet/wishes/breaks остаются читаемыми при soft-mode.

Не меняет loyalty resolve, catalog, sell.

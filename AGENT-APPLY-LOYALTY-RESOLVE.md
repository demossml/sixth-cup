# Apply loyalty resolve+reserve to sixth-cup

Распаковать поверх репозитория sixth-cup (или скопировать файлы):

- backend/src/modules/loyalty/reservations.ts (NEW)
- backend/src/modules/loyalty/resolveRoutes.ts (optional, resolve is in cardLookup)
- backend/src/modules/loyalty/cardLookup.ts
- backend/src/integrations/evotor/processing/SellHandler.ts
- backend/src/app.ts
- backend/src/db/migrations/010_loyalty_reservations.sql
- frontend/src/pages/CardPage.tsx (hint)

Проверка: curl -X POST https://app.67coffee.ru/api/loyalty/resolve -H 'Content-Type: application/json' -d '{"c":"1"}'
Сборка backend + frontend, push, deploy.

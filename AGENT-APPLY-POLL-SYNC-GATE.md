# Poll только по точкам с галочкой sync

## Проблема
Галочка «синхронизировать» в админке писала `sync_enabled` в БД, но фоновый `PollService` и catalog tick в `index.ts` брали **все** магазины из API Эвотор → 402 на магазинах без приложения.

## Исправление
- `PollService.ts` — `runFast` / `runHourly` / `runDaily` опрашивают только `sync_enabled=1`
- `index.ts` — catalog bootstrap/push только по `sync_enabled=1`

Список магазинов в админке по-прежнему подтягивается из Cloud (все), но API документов/номенклатуры вызывается только для включённых.

После деплоя: рестарт API. В логах при нуле включённых точек: `evotor poll skipped — no stores with sync_enabled=1`.

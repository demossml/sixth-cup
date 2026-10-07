# Админка: логи

Распаковать поверх sixth-cup:

- backend/src/lib/logBuffer.ts (NEW)
- backend/src/config.ts
- backend/src/app.ts
- backend/src/modules/admin/routes.ts
- frontend-admin/src/pages/AdminPage.tsx

Опционально в .env: LOG_PATH=./data/logs/api.log

Сборка backend + frontend-admin, push, на Mac mini pull + restart.

В админке вкладка «Логи»: выбрать 30/50/100… → Обновить → Копировать N строк.

# Restore admin Logs tab

Регрессия: в catalog-sync-fixed пропала вкладка «Логи» в AdminPage.tsx.
Backend (logBuffer, /api/admin/logs) в том архиве был на месте — чинится только UI.

Файл: frontend-admin/src/pages/AdminPage.tsx
Сохранены правки catalog sync (alert sync, wipe, extrasFailed).

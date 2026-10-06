# Патч: админка по TZ-ADMIN-EVOTOR-SYNC-FULL

## Файлы
- `backend/src/modules/admin/assignments.ts` — overview, PUT stores, POST sync, sales summary
- `backend/src/modules/admin/routes.ts` — mount `adminAssignments`
- `backend/src/integrations/evotor/sync/AssignmentSync.ts` — CREATE/UPDATE/disable по галочкам
- `backend/src/db/migrations/010_admin_assignments_sales.sql`
- `frontend-admin/src/pages/AdminPage.tsx` — новое меню без enroll/loyalty/ручных точек
- `docs/TZ-ADMIN-EVOTOR-SYNC-FULL.md`

## Применение
Скопировать файлы **поверх** репозитория sixth-cup (сохранить `.env`).
`npm run typecheck && npm run build`
Commit + push.

## Поведение
1. Точки — только из Эвотор (вкладка + sync).
2. Товар один + галочки точек → links → Sync CREATE/UPDATE.
3. Обзор / Продажи / Эвотор poll.

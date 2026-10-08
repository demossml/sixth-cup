# Админка: вкладка «Логи»

## Что изменено
- `backend/src/lib/logBuffer.ts` — буфер в памяти (server 3000 / client 1000 / device 1000 строк, отдельные кольца: флуд клиента не вытесняет серверные строки), маскирование секретов, опционально зеркало в `LOG_PATH`.
- `backend/src/app.ts` — middleware: строка на каждый `/api/*` (method, path без query, status, ms; для 4xx/5xx — короткий `error`). Перехват `console.*`, ошибки в `onError`.
- `backend/src/index.ts` — `uncaughtException` / `unhandledRejection` пишутся в буфер (потом процесс завершается как раньше), события Evotor poll / catalog push.
- `backend/src/modules/admin/routes.ts` — `GET /api/admin/logs`, `POST /api/admin/logs/test` (`X-Admin-Token`).
- `backend/src/modules/logs/routes.ts` — `POST /api/client-logs` (публично, лимиты: 8 КБ, 30/мин на IP, 300/мин всего).
- `backend/src/modules/devices/routes.ts` — `POST /api/devices/logs` (только с `EVOTOR_PROXY_TOKEN`), события `loyalty resolve ok/fail`.
- `backend/src/modules/loyalty/reservations.ts`, `devices/sales.ts`, `evotor/sync/PollService.ts` — события reservation / sell / poll.
- `frontend-admin/src/pages/AdminPage.tsx` — вкладка «Логи» в `<main>` (раньше UI был внутри `if (!authed)`).
- `frontend/src/lib/clientLog.ts` + `main.tsx` — PWA шлёт `error` / `unhandledrejection`.
- `backend/src/__tests__/logs.test.ts` — тесты.

## API
`GET /api/admin/logs?lines=50&source=all|server|client|device&level=all|error|warn|info`
→ `{ "lines": ["ISO [source] [level] message"], "available": N, "total": N, "generatedAt": ms }`
(`lines` ≤ 500; `available` — сколько строк подходит под фильтр; `source=kassa` — алиас `device`; уровень — точное совпадение.)

## Деплой
Env: опционально `LOG_PATH=./data/logs/api.log`. Ничего мигрировать не нужно.
Сборка backend + frontend-admin + frontend, push, на сервере pull + **restart** (буфер в памяти — до рестарта он пуст; после рестарта сразу видны «server started» и HTTP-строки).
Проверка: войти в админку → «Логи» → «Тест» → должна появиться строка `admin log test`.

## APK Эвотор
Исходников APK в репозитории нет. Контракт отправки событий — в `ANDROID_INTEGRATION_CONTRACT.md` (раздел «Till event log»); пока APK его не вызывает, вкладка «Касса» пуста, но серверные строки `loyalty resolve ok/fail` и Evotor poll видны в «Сервер».

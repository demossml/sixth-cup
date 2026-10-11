# Накат админки (Claude redesign + pass)

## MacBook

1. Распаковать архив поверх репозитория `sixth-cup` (корень = содержимое `sixth-cup-main/`).
2. Не коммитить `.env`, `*.db`, `keys.json`, `node_modules`, `dist`.
3. `npm ci`
4. `npm run typecheck`
5. `npm run test -w backend`
6. `npm run build`
7. Commit + push, например:
   `feat(admin): Claude redesign phases 0-3 + product recipe/photo fields`

## Mac mini (после push)

1. `cd ~/apps/sixth-cup`
2. Бэкап: `sqlite3 backend/data/sixth-cup.db ".backup backend/data/sixth-cup-backup-$(date +%Y%m%d-%H%M).db"`
3. `git pull --ff-only`
4. В `.env`: `ADMIN_ALLOW_RESET=0` (если нет — добавить). `ADMIN_TOKEN` / `EVOTOR_*` не трогать.
5. `npm ci && npm run build`
6. `systemctl --user restart sixth-cup-api.service`
7. Проверка:
```bash
set -a; source backend/.env; set +a
curl -sS -o /dev/null -w "html=%{http_code}\n" https://admin.67coffee.ru/
curl -sS -o /tmp/d.json -w "dash=%{http_code}\n" -H "X-Admin-Token: $ADMIN_TOKEN" http://127.0.0.1:3001/api/admin/dashboard
curl -sS -o /tmp/o.json -w "ops=%{http_code}\n" -H "X-Admin-Token: $ADMIN_TOKEN" "http://127.0.0.1:3001/api/admin/operations?limit=3"
curl -sS -o /tmp/m.json -w "meta=%{http_code}\n" -H "X-Admin-Token: $ADMIN_TOKEN" http://127.0.0.1:3001/api/admin/meta
python3 -c "import json;print(json.load(open('/tmp/m.json')))"
```
Ожидание: 200, `resetAllowed: false` на проде.

Код руками не изобретать. Caddy/gimolost2 не трогать.

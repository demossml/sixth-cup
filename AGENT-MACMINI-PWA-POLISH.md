1. sqlite3 backend/data/sixth-cup.db ".backup backend/data/sixth-cup-backup-$(date +%Y%m%d%H%M).db"
2. git pull --ff-only
3. PUSH_ENABLED=0 в .env если нет VAPID
4. npm ci && npm run build && restart sixth-cup-api
5. curl /health ; curl /api/public/content ; проверить QR на app.*

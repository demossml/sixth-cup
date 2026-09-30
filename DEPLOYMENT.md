# Развёртывание Sixth Cup на Mac mini

Только **backend + PWA**. Android/Эвотор — отдельно.

## 1. Prerequisites

- macOS на Mac mini
- **Node.js 20 LTS** (рекомендуется): https://nodejs.org/
- npm 10+
- (опционально) Caddy или nginx для HTTPS

Проверка:

```bash
node -v   # v20.x
npm -v    # 10.x+
```

## 2. Код

```bash
cd ~/apps
# git clone <ваш-репозиторий> sixth-cup
cd sixth-cup
cp .env.example backend/.env
# отредактируйте JWT_SECRET и ADMIN_TOKEN
```

## 3. Установка и сборка

```bash
npm install
npm run build
# или по частям:
# npm run build -w backend
# npm run build -w frontend
```

Frontend собирается в `frontend/dist`.  
В production backend раздаёт SPA из `../frontend/dist` (см. `backend/src/app.ts`).

## 4. База и файлы

При первом запуске:

- создаётся SQLite `DB_PATH` (по умолчанию `backend/data/sixth-cup.db`);
- применяются миграции (`schema_migrations`);
- seed: демо-организация, точки, категории, товары (если пусто).

Каталоги:

```text
backend/data/sixth-cup.db
backend/data/keys.json
backend/data/uploads/     # фото товаров
```

Бэкап:

```bash
cp backend/data/sixth-cup.db ~/backups/sixth-cup-$(date +%F).db
cp -a backend/data/uploads ~/backups/uploads-$(date +%F)
```

## 5. Запуск production

Из корня monorepo (или из backend с собранным frontend):

```bash
export NODE_ENV=production
export PORT=3000
export JWT_SECRET='...'
export ADMIN_TOKEN='...'
# пути можно абсолютные:
# export DB_PATH=/var/lib/sixth-cup/sixth-cup.db
# export UPLOADS_DIR=/var/lib/sixth-cup/uploads

cd backend
npm run start
# слушает http://127.0.0.1:3000
```

Проверка:

```bash
curl -s http://127.0.0.1:3000/health
curl -s http://127.0.0.1:3000/api/directory | head
```

## 6. HTTPS и домен

DNS: `A` / `AAAA` запись `app.example.com` → IP Mac mini.

Пример **Caddy** (`/etc/caddy/Caddyfile` или `~/Caddyfile`):

```text
app.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

```bash
caddy run --config ~/Caddyfile
```

Caddy сам выдаст Let's Encrypt сертификат.

nginx — `proxy_pass http://127.0.0.1:3000;` + certbot.

## 7. Автозапуск (launchd)

`~/Library/LaunchAgents/com.sixthcup.api.plist` — пример:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.sixthcup.api</string>
  <key>WorkingDirectory</key><string>/Users/YOU/apps/sixth-cup/backend</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>dist/index.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>PORT</key><string>3000</string>
    <key>JWT_SECRET</key><string>CHANGE_ME</string>
    <key>ADMIN_TOKEN</key><string>CHANGE_ME</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/sixth-cup.out.log</string>
  <key>StandardErrorPath</key><string>/tmp/sixth-cup.err.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.sixthcup.api.plist
```

## 8. Обновление

```bash
cd ~/apps/sixth-cup
git pull   # или скопировать новый архив
npm install
npm run build
# перезапуск process (launchctl kickstart или kill)
```

Миграции применяются при старте backend автоматически.

## 9. Доступ с телефона

1. `https://app.example.com/` — клиент PWA  
2. `https://app.example.com/admin` — админка, токен из `ADMIN_TOKEN`  
3. `https://app.example.com/menu` — меню  
4. `https://app.example.com/cashier` — PWA-касса лояльности  

Добавить на домашний экран (Safari → Поделиться → На экран «Домой»).

## 10. Dev на том же Mac

```bash
npm run dev
# Vite :5173 (proxy /api и /uploads → :3000)
# Backend :3000
```

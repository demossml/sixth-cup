# Sixth Cup — установка на Mac mini (пошагово)

Документ для агента или человека, который **поднимает production** на Mac mini.  
Не додумывать шаги: выполнять **строго по порядку**.

Android / Эвотор **не** устанавливаются этим документом.

---

## 0. Что получится в итоге

| Адрес | Кто пользуется | Что открывается |
|-------|----------------|-----------------|
| `https://app.ВАШ_ДОМЕН` | Клиенты (гости кофейни) | Карта лояльности, меню, акции, профиль; при необходимости `/cashier` |
| `https://admin.ВАШ_ДОМЕН` | Владелец / администратор | Юрлица, НДС, точки, категории, товары, кассы, акции |
| Один процесс Node на Mac mini | — | API `/api/*`, файлы `/uploads/*`, раздача нужного frontend по заголовку `Host` |

**Важно:** клиентский бандл **не содержит** админку. Владелец заходит **только** на `admin.*`.

Замените `ВАШ_ДОМЕН` на реальный домен, например `sixthcup.ru` →  
`app.sixthcup.ru` и `admin.sixthcup.ru`.

---

## 1. Что нужно заранее

### 1.1. Железо и доступ

- [ ] Mac mini включён, есть пароль администратора macOS  
- [ ] Статический IP в локальной сети **или** понимание, какой IP у mini в LAN  
- [ ] Доступ в интернет с mini  
- [ ] SSH или физический доступ к Terminal  

### 1.2. Домен

- [ ] Зарегистрирован домен (регистратор: REG.RU, Cloudflare, Namecheap и т.д.)  
- [ ] Есть доступ в панель DNS этого домена  

### 1.3. Код

- [ ] Репозиторий Sixth Cup на GitHub (после merge архива `sixth-cup-two-hosts`)  
- [ ] В репо есть папки: `backend/`, `frontend/`, `frontend-admin/`  

### 1.4. Секреты (придумать до установки, **не** коммитить в git)

Сгенерировать длинные случайные строки:

```bash
openssl rand -hex 32   # → JWT_SECRET
openssl rand -hex 24   # → ADMIN_TOKEN
```

Записать в безопасное место (1Password / файл только на mini, не в git).

---

## 2. DNS — зарегистрировать поддомены

В панели DNS домена создать **две** записи типа **A** (или AAAA, если только IPv6).

| Имя (host) | Тип | Значение | TTL |
|------------|-----|----------|-----|
| `app` | A | **публичный IP** Mac mini (или IP роутера, если проброс портов) | 300 или Auto |
| `admin` | A | **тот же** IP | 300 или Auto |

Если Mac mini **за NAT** (домашний роутер):

1. Узнать внешний IP: https://ifconfig.me  
2. На роутере пробросить порты **80** и **443** TCP → локальный IP Mac mini.  
3. В DNS указать **внешний** IP.

Если IP динамический — использовать Cloudflare + обновление IP или статический IP от провайдера.

Проверка через 5–15 минут (с любого ПК):

```bash
dig +short app.ВАШ_ДОМЕН
dig +short admin.ВАШ_ДОМЕН
# оба должны показать один и тот же IP
```

Пока DNS не указывает на mini — **не** ожидать, что HTTPS заработает.

---

## 3. Установка ПО на Mac mini

Открыть Terminal.

### 3.1. Homebrew (если ещё нет)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Для Apple Silicon после установки выполнить строки, которые brew напечатает (`eval "$(/opt/homebrew/bin/brew shellenv)"`).

### 3.2. Node.js 20 LTS

```bash
brew install node@20
brew link node@20 --force --overwrite
node -v    # должно быть v20.x
npm -v     # 10.x+
```

### 3.3. Caddy (HTTPS и reverse proxy)

```bash
brew install caddy
caddy version
```

Caddy сам получит сертификаты Let's Encrypt для доменов.

---

## 4. Клонирование кода

```bash
mkdir -p ~/apps
cd ~/apps
git clone URL_ВАШЕГО_РЕПОЗИТОРИЯ sixth-cup
cd sixth-cup
git checkout main
# или ветка, куда запушили two-hosts
```

Проверить структуру:

```bash
ls backend frontend frontend-admin package.json DEPLOYMENT.md
```

Все четыре пути должны существовать.

---

## 5. Переменные окружения

```bash
cd ~/apps/sixth-cup
cp .env.example backend/.env
nano backend/.env
```

Минимальный `backend/.env` для production:

```env
NODE_ENV=production
PORT=3000
JWT_SECRET=СЮДА_РЕЗУЛЬТАТ_openssl_rand_hex_32
ADMIN_TOKEN=СЮДА_РЕЗУЛЬТАТ_openssl_rand_hex_24
DB_PATH=/Users/ВАШ_USER/apps/sixth-cup/backend/data/sixth-cup.db
KEYS_PATH=/Users/ВАШ_USER/apps/sixth-cup/backend/data/keys.json
UPLOADS_DIR=/Users/ВАШ_USER/apps/sixth-cup/backend/data/uploads
ADMIN_HOST=admin.ВАШ_ДОМЕН
```

Замените `ВАШ_USER` на имя пользователя macOS (`whoami`).  
Замените `ВАШ_ДОМЕН` на реальный домен.

Создать каталоги данных:

```bash
mkdir -p ~/apps/sixth-cup/backend/data/uploads
```

**Не** добавлять `backend/.env` в git.

---

## 6. Установка зависимостей и сборка

```bash
cd ~/apps/sixth-cup
npm install
npm run build
```

Ожидается успешная сборка:

- `backend/dist/`
- `frontend/dist/`
- `frontend-admin/dist/`

Проверка:

```bash
test -f backend/dist/index.js && echo backend_ok
test -f frontend/dist/index.html && echo customer_ok
test -f frontend-admin/dist/index.html && echo admin_ok
```

Тесты (желательно):

```bash
npm run test -w backend
```

---

## 7. Первый запуск API (проверка без HTTPS)

```bash
cd ~/apps/sixth-cup/backend
set -a && source .env && set +a
node dist/index.js
```

В другом окне Terminal:

```bash
curl -s http://127.0.0.1:3000/health
# {"ok":true}

curl -s http://127.0.0.1:3000/api/directory | head -c 200
```

Остановить процесс: `Ctrl+C`.

---

## 8. Caddy — HTTPS на оба поддомена

Создать файл:

```bash
mkdir -p ~/apps/sixth-cup/deploy
nano ~/apps/sixth-cup/deploy/Caddyfile
```

Содержимое (подставить домен):

```caddy
app.ВАШ_ДОМЕН {
	reverse_proxy 127.0.0.1:3000
}

admin.ВАШ_ДОМЕН {
	reverse_proxy 127.0.0.1:3000
}
```

Оба поддомена идут на **один** Node. Node сам отдаёт нужный UI по `Host`.

Запуск Caddy вручную (проверка):

```bash
cd ~/apps/sixth-cup/deploy
caddy run --config Caddyfile
```

В логах Caddy должны появиться успешные сертификаты для `app.` и `admin.`.

Проверка с телефона или другого ПК (когда DNS уже указывает сюда):

- https://app.ВАШ_ДОМЕН/  
- https://admin.ВАШ_ДОМЕН/  

На admin — форма входа с `ADMIN_TOKEN`.  
На app — онбординг/логин клиента (без админки).

Остановить Caddy: `Ctrl+C`.

---

## 9. Автозапуск Node (launchd)

### 9.1. Скрипт старта

```bash
nano ~/apps/sixth-cup/deploy/start-api.sh
```

```bash
#!/bin/bash
set -euo pipefail
cd /Users/ВАШ_USER/apps/sixth-cup/backend
set -a
source /Users/ВАШ_USER/apps/sixth-cup/backend/.env
set +a
exec /opt/homebrew/bin/node dist/index.js
```

На Intel Mac путь node может быть `/usr/local/bin/node` — проверить: `which node`.

```bash
chmod +x ~/apps/sixth-cup/deploy/start-api.sh
```

### 9.2. plist

```bash
nano ~/Library/LaunchAgents/com.sixthcup.api.plist
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.sixthcup.api</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/ВАШ_USER/apps/sixth-cup/deploy/start-api.sh</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/sixth-cup-api.out.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/sixth-cup-api.err.log</string>
</dict>
</plist>
```

```bash
launchctl unload ~/Library/LaunchAgents/com.sixthcup.api.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.sixthcup.api.plist
curl -s http://127.0.0.1:3000/health
```

Логи: `tail -f /tmp/sixth-cup-api.err.log`

---

## 10. Автозапуск Caddy

```bash
nano ~/Library/LaunchAgents/com.sixthcup.caddy.plist
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.sixthcup.caddy</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/caddy</string>
    <string>run</string>
    <string>--config</string>
    <string>/Users/ВАШ_USER/apps/sixth-cup/deploy/Caddyfile</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/sixth-cup-caddy.out.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/sixth-cup-caddy.err.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.sixthcup.caddy.plist
```

Caddy слушает 80/443 — macOS может запросить разрешение firewall; разрешить входящие для caddy.

---

## 11. Приёмка после установки

С телефона в LTE (не только Wi‑Fi кофейни):

| Шаг | Действие | Ожидание |
|-----|----------|----------|
| 1 | Открыть `https://app.ВАШ_ДОМЕН` | Клиентское приложение, **нет** пункта «Админ» |
| 2 | Открыть `https://admin.ВАШ_ДОМЕН` | Вход по токену |
| 3 | Ввести `ADMIN_TOKEN` | Кабинет: Юрлица, Точки, Товары… |
| 4 | Создать юрлицо + НДС | Сохраняется |
| 5 | Создать точку | Привязка к юрлицу |
| 6 | Категория + товар с фото | В списке админки |
| 7 | Обновить `https://app.ВАШ_ДОМЕН/menu` | Товар и фото видны |
| 8 | `curl -s https://app.ВАШ_ДОМЕН/api/directory \| head` | JSON каталога |

---

## 12. Обновление версии с GitHub

```bash
cd ~/apps/sixth-cup
git pull
npm install
npm run build
launchctl kickstart -k gui/$(id -u)/com.sixthcup.api
# Caddy обычно не перезапускать, если Caddyfile не менялся
```

Миграции БД применяются при старте backend сами.  
Каталог `backend/data/` **не** удалять.

---

## 13. Бэкап

Раз в день (cron или вручную):

```bash
mkdir -p ~/backups/sixth-cup
cp ~/apps/sixth-cup/backend/data/sixth-cup.db ~/backups/sixth-cup/db-$(date +%F).db
cp -a ~/apps/sixth-cup/backend/data/uploads ~/backups/sixth-cup/uploads-$(date +%F)
```

---

## 14. Частые проблемы

| Симптом | Что проверить |
|---------|----------------|
| DNS не резолвится | Записи A, время распространения, IP |
| Caddy не выдаёт сертификат | Порты 80/443 снаружи, DNS уже на mini |
| admin открывает клиентское UI | `ADMIN_HOST` в `.env`, Host реально `admin.домен`, собран `frontend-admin/dist` |
| app открывает админку | Не должен; если да — ошибка Host / FORCE_ADMIN |
| 502 | Node не запущен: `curl :3000/health`, логи launchd |
| Фото 404 | `UPLOADS_DIR`, права на запись, URL `/uploads/...` |
| Забыли ADMIN_TOKEN | Только в `backend/.env` на mini |

---

## 15. Чего этот документ не делает

- Не ставит Android / Эвотор  
- Не настраивает SMS-провайдера (в dev коды в ответе API)  
- Не настраивает Cloudflare Tunnel (можно позже вместо проброса портов)  

---

## 16. Краткий чеклист агента

1. DNS: `app` + `admin` → IP mini  
2. brew: node@20, caddy  
3. git clone → `npm install` → `npm run build`  
4. `backend/.env` с секретами и `ADMIN_HOST`  
5. launchd: API + Caddy  
6. Проверка https app + https admin + создание товара + меню  

Готово, когда шаги 1–6 выполнены и таблица приёмки (§11) зелёная.

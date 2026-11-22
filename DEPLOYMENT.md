# Развёртывание 6.7 Coffee (два поддомена)

## Поддомены

| Host | Назначение |
|------|------------|
| `app.example.com` | Клиент PWA (карта, меню, профиль, /cashier) |
| `admin.example.com` | Только кабинет владельца |
| `app.example.com/barista/` | Экран бариста (очередь заказов), отдельная сборка |
| API | тот же origin `/api` на обоих (один backend) |

Админ-код **не** входит в клиентский бандл.

## Сборка

```bash
npm install
npm run build
# собирает backend + frontend (клиент) + frontend-admin + frontend-barista
```

Артефакты:

- `frontend/dist` — клиент  
- `frontend-admin/dist` — админ  
- `frontend-barista/dist` — экран бариста, отдаётся по `/barista/`  
- `backend/dist` — API  

## Env

Полный список с комментариями — `.env.example` в корне репозитория. Скопируй его в `.env`
и заполни значения.

### Критические переменные (P0-01 / P0-04)

При `NODE_ENV=production` backend **падает на старте**, если не задана хотя бы одна
из этих переменных (проверка `productionConfigIssues` в `backend/src/config.ts`):

| Переменная | Зачем | Что будет без неё |
|---|---|---|
| `JWT_SECRET` | подпись гостевых JWT и админ-сессий | старт запрещён; дефолт `dev-secret-change-me` в проде не принимается |
| `ADMIN_TOKEN` | доступ к админке (`X-Admin-Token`) | старт запрещён; дефолт `dev-admin` в проде не принимается |
| `EVOTOR_PROXY_TOKEN` | общий секрет кассовых API | старт запрещён. Раньше отсутствие токена **отключало** проверку и касса была открыта (P0-01), теперь без токена кассовые ручки отвечают `503 proxy_not_configured` |
| `PUBLIC_BASE_URL` | публичный адрес PWA для QR/ссылок | старт запрещён; нужен полный `https://…` |
| `TRUST_PROXY_HEADERS` | доверять ли `X-Forwarded-For` | старт запрещён; принимаются только `0` или `1`. `1` — только если перед Node реально стоит прокси (Caddy/nginx), иначе IP подделывается и IP-лимиты бесполезны |

Итого минимальный прод-конфиг:

```bash
NODE_ENV=production
PORT=3000
JWT_SECRET=...
ADMIN_TOKEN=...
EVOTOR_PROXY_TOKEN=...
PUBLIC_BASE_URL=https://app.example.com
TRUST_PROXY_HEADERS=1
DB_PATH=./data/sixth-cup.db
UPLOADS_DIR=./data/uploads
# опционально точный host админки:
ADMIN_HOST=admin.example.com
# сброс данных из админки: в production по умолчанию ВЫКЛЮЧЕН; включать только осознанно
# ADMIN_ALLOW_RESET=1
# пороги статуса кассы, минуты с последнего успешного опроса (по умолчанию 5 / 30)
# EVOTOR_HEALTH_WARN_MIN=5
# EVOTOR_HEALTH_CRIT_MIN=30
```

`ORDER_QR_SECRET` не обязателен: без него QR предзаказа подписывается `JWT_SECRET`.
Отдельный секрет позволяет отзывать коды заказов, не ломая сессии гостей.

### Проверка перед выкладкой

```bash
# приложение должно упасть с понятным списком, если чего-то не хватает
NODE_ENV=production node -e "import('./backend/dist/index.js')" || true
# и стартовать, когда всё задано
curl -fsS http://127.0.0.1:3000/health
```

Backend по заголовку `Host`:

- начинается с `admin.` **или** равен `ADMIN_HOST` → `frontend-admin/dist`  
- иначе → `frontend/dist`

## Caddy

```text
app.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3000
}

admin.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3000
}
```

Оба указывают на один Node-процесс.

Сжатие на Caddy закрывает JSON API и HTML. Hashed `/assets/*` кэшируются
заголовками backend (`Cache-Control: immutable`, см. p0-step04). `index.html` —
`no-cache`, чтобы обновления доезжали.

## Dev

```bash
npm run dev
# backend   :3000
# клиент    :5173
# админ     :5174  (http://localhost:5174)
# бариста   :5175  (http://localhost:5175/barista/ — vite проксирует /api на :3000)
```

## Бариста (очередь заказов)

- Вход — логин/пароль сотрудника (страница админки «Логины»). Создать пользователя можно только
  с ролью `barista` и обязательной точкой; `owner`/`admin` видят все точки.
- Пароли хранятся как scrypt-хэш (`node:crypto`), сброс пароля отзывает выданные токены.
- Касса создаёт заказ сама после ухода продажи: `POST /api/devices/kitchen/orders` (прокси-токен Эвотора,
  идемпотентность по `clientOrderId`).
- `ADMIN_TOKEN` остаётся аварийным входом в админку и не используется экраном бариста.
- Полный контракт и статусы — [docs/BARISTA-QUEUE.md](./docs/BARISTA-QUEUE.md).

## Важно

- Клиент **не** видит `/admin` и ссылки на админку.  
- Владелец открывает только `https://admin.example.com`.  
- Секрет: `ADMIN_TOKEN`, не «скрытие кнопки».

> HISTORICAL: SMS authentication is not used by the current anonymous loyalty flow. Do not configure SMS for the current product.

## Legacy SMS (not used)

В `backend/.env` на Mac mini (значения не в git):

```env
SMS_PROVIDER=smsaero
SMS_AERO_EMAIL=...
SMS_AERO_API_KEY=...
SMS_AERO_SENDER=...
```

Подробнее: `docs/SMS.md`.

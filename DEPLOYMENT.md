# Развёртывание Sixth Cup (два поддомена)

## Поддомены

| Host | Назначение |
|------|------------|
| `app.example.com` | Клиент PWA (карта, меню, профиль, /cashier) |
| `admin.example.com` | Только кабинет владельца |
| API | тот же origin `/api` на обоих (один backend) |

Админ-код **не** входит в клиентский бандл.

## Сборка

```bash
npm install
npm run build
# собирает backend + frontend (клиент) + frontend-admin
```

Артефакты:

- `frontend/dist` — клиент  
- `frontend-admin/dist` — админ  
- `backend/dist` — API  

## Env

```bash
NODE_ENV=production
PORT=3000
JWT_SECRET=...
ADMIN_TOKEN=...
DB_PATH=./data/sixth-cup.db
UPLOADS_DIR=./data/uploads
# опционально точный host админки:
ADMIN_HOST=admin.example.com
```

Backend по заголовку `Host`:

- начинается с `admin.` **или** равен `ADMIN_HOST` → `frontend-admin/dist`  
- иначе → `frontend/dist`

## Caddy

```text
app.example.com {
  reverse_proxy 127.0.0.1:3000
}

admin.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

Оба указывают на один Node-процесс.

## Dev

```bash
npm run dev
# backend :3000
# клиент  :5173
# админ   :5174  (http://localhost:5174)
```

## Важно

- Клиент **не** видит `/admin` и ссылки на админку.  
- Владелец открывает только `https://admin.example.com`.  
- Секрет: `ADMIN_TOKEN`, не «скрытие кнопки».

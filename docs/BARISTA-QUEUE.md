# Очередь бариста (backend + admin + web)

Источник заказа — **вариант A**: касса (APK) сама создаёт kitchen-заказ после ухода продажи.
Poll Эвотора не является первичным источником; `evotor_doc_id` можно привязать позже.

## Роли и вход

| Роль | Видит | Где работает |
|------|-------|--------------|
| `owner` | все точки | админка + экран бариста |
| `admin` | все точки | админка + экран бариста |
| `barista` | только свою точку (обязательный `store_uuid`) | только экран бариста |

- Пользователи создаются в админке: **Логины** (`/app-users` в UI, `GET/POST/PATCH /api/admin/app-users`).
- Пароль — только scrypt-хэш (`node:crypto`), открытый текст нигде не хранится и не логируется.
- Вход: `POST /api/staff/login` → JWT на 12 часов (`typ: 'staff'`). Сброс пароля инкрементирует
  `token_version` и отзывает старые токены.
- `ADMIN_TOKEN` остаётся аварийным входом в админку и **не** даёт доступа к staff-роутам как «сотрудник».

## Endpoints

| Метод | Путь | Auth | Назначение |
|-------|------|------|------------|
| POST | `/api/staff/login` | — | `{login, password}` → `{token, role, storeUuid, alertBlink, displayName}`; 401 неверно, 403 отключён |
| GET | `/api/staff/me` | staff JWT | профиль |
| PATCH | `/api/staff/me` | staff JWT | `{alertBlink}` — моргание новых заказов |
| GET | `/api/staff/kitchen/orders?status=active` | staff JWT | `new/seen/in_progress` точки |
| POST | `/api/staff/kitchen/orders/:id/seen` | staff JWT | `new → seen`, идемпотентно |
| POST | `/api/staff/kitchen/orders/:id/done` | staff JWT | `→ done` один раз, push гостю |
| POST | `/api/devices/kitchen/orders` | касса (device/proxy) | создание заказа, идемпотентно |
| GET | `/api/devices/kitchen/orders?storeUuid=&since=` | касса (device/proxy) | недавние заказы, чтобы показать «готов» |

### Контракт создания (касса)

```jsonc
POST /api/devices/kitchen/orders
// Authorization: Bearer <EVOTOR_PROXY_TOKEN>, X-Evotor-Store-Uuid: <store>
{
  "clientOrderId": "uuid-per-checkout",
  "storeUuid": "<store>",
  "items": [{ "name": "Капучино 350", "qty": 1, "mods": ["Овсяное"], "note": null }],
  "totalKopecks": 25000,
  "guestUserId": null,
  "cardCodeMask": null,
  "queueOrderId": null
}
// 200: { "id": "...", "queueNumber": 12, "status": "new", "createdAt": 1690000000000 }
```

- Повтор с тем же `clientOrderId` возвращает **тот же** заказ (уникальность `(store_uuid, client_order_id)`).
- Номер очереди выдаёт `modules/queue/numbers.ts` — тот же счётчик, что печатается на чеке.
  Если касса уже взяла номер (`queueOrderId`), он переиспользуется.
- `storeUuid` из тела должен совпадать с `X-Evotor-Store-Uuid`, иначе 400.

## Экран бариста

Production: экран бариста встроен в админскую сборку `frontend-admin` и открывается только на
админском поддомене:
`https://admin.example.com/barista/`.
Адрес не требует общей Wi-Fi сети устройства бариста с сервером и не показывает бариста на гостевом PWA.
Гостевой `/barista/` не обслуживается на app-поддомене.

Вход на админском домене поддерживает два способа:
- `Токен админа` — вход в кабинет владельца;
- `Логин и пароль` — вход сотрудника или бариста и переход в `/barista/`.

- Опрос каждые 2 с, при возврате вкладки — сразу.
- Новый заказ моргает (CSS-анимация), тап по карточке → `seen` и моргание прекращается;
  настройка «Моргание» хранится на сервере (`alert_blink`), при `prefers-reduced-motion` анимация статична.
- «Исполнен» — кнопка не меньше 56 px, после `done` заказ уходит из очереди.
- Портрет и ландшафт: в ландшафте сетка становится двухколоночной, safe-area учитывается.
- Нет сети — плашка, последний полученный список остаётся на экране.

## Push гостю

При переходе в `done` и известном `guestUserId` отправляется push «Заказ №N готов».
Нет подписки или ключей VAPID — отправок 0, заказ всё равно исполнен. Ответ `done` не зависит от push.

## Проверка

```bash
cd backend && npm test            # 152 файла / 1160 тестов (baseline 148 / 1125)
npm run typecheck                 # из корня: backend + frontend + frontend-admin + frontend-barista
npm test -w @sixth-cup/frontend-barista

# живая симуляция на staging (нужна привязанная к Эвотору точка):
BASE=https://api.example.com ADMIN_TOKEN=... PROXY_TOKEN=... STORE_UUID=... \
  node scripts/barista-queue-smoke.mjs
```

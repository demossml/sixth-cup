# Web Push: «заказ готов»

Транзакционные уведомления PWA. Включаются только при наличии VAPID-ключей: без них фича целиком
выключена (`GET /api/push/public-key` → `503 push_disabled`), заказ работает как обычно.

## ENV (не в git)

```
VAPID_PUBLIC_KEY=<base64url, 65 байт>
VAPID_PRIVATE_KEY=<base64url>
VAPID_SUBJECT=mailto:hello@67coffee.ru
```

Ключи генерируются один раз: `npx web-push generate-vapid-keys`.
Публичный ключ уходит в браузер, приватный не покидает сервер.

## Как работает

1. Браузер: `pushState()` проверяет поддержку + наличие ключа на сервере.
2. Гость жмёт «Включить уведомления» (экран заказа) → `POST /api/push/subscribe`
   с `endpoint`, `keys.p256dh`, `keys.auth`, `user_agent`. Endpoint уникален — повторная
   подписка обновляет ключи и снимает `revoked_at`.
3. Статус заказа меняется (`accepted/cooking/ready/paid`) → `notifyOrderStatus` отправляет
   один пуш на переход — только «готов» и «оплачен».
4. `404/410` от push-сервиса → подписка помечается `revoked_at` и больше не используется.
5. SW (`public/push-sw.js`) показывает уведомление; тап открывает `/menu?order=<id>`.

## API

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/push/public-key` | публичный VAPID-ключ (без авторизации) |
| POST | `/api/push/subscribe` | сохранить/обновить подписку гостя |
| DELETE | `/api/push/subscribe` | отписаться (по `endpoint`) |

## Данные

`push_subscriptions`: `endpoint` (UNIQUE), `p256dh`, `auth`, `user_id`, `user_agent`,
`last_sent_at`, `failures`, `revoked_at` (миграция `046_push.sql`, аддитивная).

`preorders.push_ready_at` / `push_paid_at` — отметки, чтобы не отправлять пуш дважды.

## Откат

1. Убрать `VAPID_*` из ENV и перезапустить backend — ручки начнут отвечать `503`, UI скроет кнопку.
2. Таблицу и колонки можно оставить: они не влияют на заказ.
3. Полный откат схемы — `backend/src/db/migrations/046_push.rollback.sql`.

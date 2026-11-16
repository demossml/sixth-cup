# BONUS-LOYALTY — бонусная лояльность (вариант B)

Дата: 16.11.2026. Флаг: `LOYALTY_BONUS_MODE` (по умолчанию **включён**).

## Что это

Гость копит **процент деньгами** и платит бонусами **до 100 % чека**. Чашки-подарки
(«5+1») в бонусном режиме не начисляются: старый контур остаётся в коде и включается
флагом `LOYALTY_BONUS_MODE=0`.

Все суммы — **целые копейки**. Проценты — **basis points** (bps): `500` = 5,00 %.
Причина: `floor(копейки × bps / 10000)` не даёт дробей и округляет в пользу кофейни.

## Настройки

| Что | Где хранится | Кто меняет |
|---|---|---|
| Глобальный процент (все гости) | `loyalty_settings.earn_percent_bps`, строка `id=1`, дефолт `500` (5 %) | админка «Бонусы» (owner/manager), viewer — только чтение |
| Индивидуальный процент гостя | `users.bonus_percent_bps` (`NULL` = наследует глобальный) | админка, карточка клиента |
| Согласие на обработку ПД | `users.pd_consent_at`, `users.pd_consent_version` | только регистрация по телефону |
| Аудит изменения индивидуального процента | `bonus_percent_audit(user_id, old_bps, new_bps, at, admin)` | автозапись при изменении |

Приоритет: `users.bonus_percent_bps` → `loyalty_settings.earn_percent_bps` → `500`.

## Деньги

- **Earn base** (база начисления) = `max(0, суммаЧека − списанныеБонусы)`. То есть
  процент начисляется только на деньги, которые гость реально заплатил.
- **Spend cap** (потолок списания) = `min(балансГостя, суммаЧека)` — до 100 % чека,
  но не больше баланса. Касса не может повлиять на сумму: сервер режет сам.
- Начисление: `earn = floor(base × bps / 10000)`, пишется отдельной строкой журнала
  `loyalty_ledger.source_type='EVOTOR_BONUS_EARN'`.
- Списание: строка `operation='SPEND'`, `source_type='EVOTOR_SELL'`.
- Возврат (`PAYBACK`): сторно начисления **пропорционально** доле возврата от суммы
  исходного чека. Недобор (гость уже потратил) фиксируется спором
  `bonus_earn_reversal_shortfall` и не уводит баланс в минус.

## Контракт API

### Касса (device proxy, `X-Evotor-Proxy-Token` + `X-Evotor-Store-Uuid`)

`POST /api/devices/customers/lookup` — поиск клиента по телефону, только чтение.

```json
{ "phone": "+7 999 123-45-67" }
```
Ответ найден:
```json
{ "ok": true, "found": true, "userId": 12, "cardCode": "0012", "cardId": "…",
  "phoneMasked": "+7 ••• ••• 45 67", "balanceKopecks": 12500,
  "effectiveEarnPercent": 5, "earnSource": "global",
  "pdConsentAt": null, "pdConsentVersion": null }
```
Не найден: `{ "ok": true, "found": false }`. Мусор в номере — `400`.
Лимит: 120 запросов в минуту на устройство (или магазин).

`POST /api/devices/customers/register` — выдать карту по телефону.

```json
{ "phone": "+79991234567", "pdConsent": true, "pdConsentVersion": "2026-11-01", "source": "till" }
```
Без `pdConsent: true` и без версии согласия — `400` (явное требование ПД).
Повторный вызов с тем же номером возвращает того же гостя: `created: false`.
Лимит: 30 запросов в минуту.

`POST /api/devices/loyalty/resolve` — проверка карты и резерв. Принимает `code` или `phone`
(хотя бы одно). Возвращает `balanceKopecks`, `effectiveEarnPercent`, `freeAvailable`
(в бонусном режиме всегда `0`), `canRedeem` (можно ли списывать бонусы).

### PWA (`Authorization: Bearer <jwt>`)

`GET /api/loyalty/ledger?limit=50` — движения бонусов текущего гостя.

```json
{ "balanceKopecks": 12500, "effectiveEarnPercent": 5,
  "items": [{ "id": 41, "kind": "EARN", "cashbackDelta": 5000,
              "source": "EVOTOR_BONUS_EARN", "sourceId": "<doc-uuid>",
              "at": "2026-11-16T09:12:00.000Z" }] }
```

`/api/sync` в `me` отдаёт `bonusMode: true`, `effectiveEarnPercent` и `cashbackBalance`:
по `bonusMode` PWA показывает баланс в рублях вместо прогресса чашек.

### Админка (`X-Admin-Token`)

| Метод | Путь | Смысл |
|---|---|---|
| GET | `/api/admin/loyalty/settings` | глобальный процент + режим |
| PUT | `/api/admin/loyalty/settings` | `{ earnPercent: 0..100 }`, пишет аудит |
| GET | `/api/admin/customers?query=<телефон/карта/id>` | поиск, отдаёт `bonusPercent`, `effectivePercent` |
| GET | `/api/admin/customers/:id` | баланс, `bonusPercent`/`effectivePercent`, `earnSource`, `phoneMasked` |
| PUT | `/api/admin/customers/:id/bonus-percent` | `{ percent: number \| null }`, `null` = сброс к глобальному |
| GET | `/api/admin/customers/:id/ledger` | последние движения бонусов |

`viewer` получает `403` на любые изменения процента. Сырой телефон в ответах карточки
не отдаётся — только маска (`GET /customers/:id/phone` остаётся отдельным
аудируемым вызовом).

## Миграции

`071_loyalty_bonus.sql`: `loyalty_settings`, `users.bonus_percent_bps`,
`users.pd_consent_at`, `users.pd_consent_version`, `users.phone_bound_at`,
`bonus_percent_audit`. Все чтения настроек терпимы к старой БД (без миграции
работает дефолт 5 %).

## Как включить и выключить

- Бонусный режим (по умолчанию): `LOYALTY_BONUS_MODE=1`.
- Старый контур чашек: `LOYALTY_BONUS_MODE=0` — подарки и `cards.paid_total`
  работают как раньше, процент не начисляется.

## Ограничения (сознательно не делаем в этой серии)

- SMS-подтверждение телефона — нет.
- Конвертация старых free-чашек в рубли — нет, баланс `cashback_balance` не трогаем.
- Удаление `cards.paid_total` — нет, таблица остаётся для истории.
- Код APK-приложения кассы — не менялся.

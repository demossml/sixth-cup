# Подарки, реферал и ваучеры: backend V1 (28.10.2026)

Памятка по серии «подарки · реферал 3% · ваучеры»: что изменилось в лояльности,
какие поля появились в контракте кассы и что осталось на стороне APK.

Предыдущая серия — [LOYALTY-BACKEND-2026-10](./LOYALTY-BACKEND-2026-10.md).
Каналы записи — [LOYALTY-CHANNELS](./LOYALTY-CHANNELS.md).

## 1. Подарки (free cup): повторная обработка больше не сжигает льготу

- `consumeReservation` идемпотентен по документу: если резерв уже `CONSUMED`
  **этим же** `doc_store/doc_id`, льготы возвращаются повторно. Раньше сбой транзакции
  после consume оставлял гостя без бесплатной чашки при повторном poll.
- Спор `loyalty_claim_clamped` теперь содержит `freeAvail`, `cups`, `hadReservation`,
  `reservationId` — причину урезания видно без похода в код.
- Правила не менялись: льготы списывает только подписанный QR с резервом (`sc.op`),
  числовой код карты — только начисление.

## 2. Реферал 3%

- Формула прежняя: `floor((amount − appliedCb) × referralCashbackPercent / 100)`.
- `GET /sync/history` дополнен строкой `referral` у пригласившего; контракт зафиксирован тестами.
- Карточка клиента в админке отдаёт построчные начисления кэшбэка с полем
  `source: 'referral' | 'game'` (игровые — `receipt_id LIKE 'game:%'`).

## 3. Ваучеры: шаблоны

Миграция `036_voucher_templates_v1`:

| Таблица | Поле | Смысл |
|---|---|---|
| `voucher_templates` | `active` | шаблон можно выдавать (по умолчанию 1) |
| `voucher_templates` | `image_url` | `/uploads/…` или `https://…` |
| `voucher_templates` | `redemption_mode` | `once` (по умолчанию) \| `multi` |
| `voucher_templates` | `max_per_day` | лимит гашений экземпляра в сутки (multi) |
| `voucher_templates` | `max_total` | общий лимит гашений экземпляра (multi) |
| `voucher_templates` | `stackable_with_free_cup` | совместимость с шестой чашкой (по умолчанию 1) |
| `vouchers` | `redemptions_count` | сколько раз погашен экземпляр |
| `voucher_redemptions` | — | журнал гашений, UNIQUE `(voucher_id, receipt_id)` |

Админ-API:

- `GET /api/admin/voucher-templates` (расширен полями, `?all=1` — включая выключенные);
- `POST /api/admin/voucher-templates`;
- `PATCH /api/admin/voucher-templates/:id`.

Права — как у `vouchers/grant-all`: `owner` может всё, `manager` получает 403 на запись,
`viewer` только читает. Валидация живёт в одной Zod-схеме (`templateCreateZ` / `templatePatchZ`
в `modules/vouchers/service.ts`): `kind ∈ {percent, fixed}`, `value > 0`, `percent ≤ 100`,
`validDays 1…3650`, `imageUrl` = `/uploads/…` или `https://…`, уникальный `code`.
Сообщения об ошибках — русские и уходят в 400 как есть.

Выдаются только шаблоны с `active = 1`: `grantVoucher`/`grantVoucherOnce` бросают ошибку
на выключенном шаблоне, а `POST /vouchers/grant-all`, выдача одному клиенту и
`grant-all/preview` отвечают 400 «Шаблон выключен». Seed гарантирует WELCOME с `active = 1`
и не создаёт дубликат при повторном запуске.

Карточка клиента в админке отдаёт по каждому ваучеру `redemptionMode`, `redemptionsCount`,
`receiptId` и `templateCode` — поддержке видно, сколько раз погашен многоразовый экземпляр.

## 4. Ваучеры: pre-view на кассе (`resolve`)

Успешный `POST /api/devices/loyalty/resolve` для **QR-карты** теперь отдаёт массив:

```json
"vouchers": [
  { "id": 12, "title": "Кофе в подарок", "kind": "fixed", "value": 300,
    "redemptionMode": "once", "stackableWithFreeCup": true, "expiresDay": 20345,
    "imageUrl": null }
]
```

- числовой код карты — `vouchers: []` (ничего не показываем и не гасим);
- попадают только непросроченные, непогашенные (для `once`) и не исчерпавшие `max_total` (для `multi`);
- лимит списка — `maxVouchersInCard`;
- резерва ваучера на этапе `resolve` нет (V1).

## 5. Ваучеры: гашение в основном потоке

`extras.sc.voucherId` (number) — id из таблицы `vouchers`, который касса применяет к чеку.

- Гаснет **только** с QR-картой (`isToken`); числовой код игнорируется.
- `once` → `used_at`, `receipt_id` = id документа; `multi` → `redemptions_count++`
  с проверками `max_per_day` / `max_total`.
- Факт гашения пишется в журнал `voucher_redemptions` (UNIQUE по ваучеру и чеку) —
  повторный poll того же документа не гасит второй раз.
- Невалидный ваучер (чужой, просрочен, уже использован, лимит, несовместим с подарком)
  → спор `voucher_not_redeemed` с полем `reason`; продажа и остальная лояльность
  применяются штатно.
- `stackable_with_free_cup = 0` и `appliedFree > 0` → `voucher_not_stacked_with_free`.
- Применённый ваучер виден в `loyalty_ops.voucher` как `v:<id>`.

## 6. Осталось на APK / PWA

- Касса: показать список `vouchers` гостю и передавать выбранный `sc.voucherId`.
- Касса: применить рублёвую скидку ваучера в позиции чека (backend её не считает по ОФД).
- PWA: отобразить ваучеры с картинкой и сроком; экран «мои ваучеры» пока читает старые поля.
- Админка: экран CRUD шаблонов (API готов, UI не делался в этой серии).

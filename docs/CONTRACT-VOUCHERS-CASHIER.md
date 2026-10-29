# Контракт ваучеров касса ↔ backend

## resolve (POST /api/devices/loyalty/resolve)

Поле `vouchers` присутствует всегда. Непусто только если: `VOUCHERS_IN_RESOLVE=1`, код — подписанный QR (`kind: 'token'`),
резерв создан или продлён своей кассой. Иначе `[]` (ручной числовой код, ALREADY_RESERVED, флаг выключен).

Элемент: `{ id, title, kind: 'percent'|'fixed', value, redemptionMode: 'once', stackableWithFreeCup: false, expiresDay|null, imageUrl|null }`

- percent: value 1..100; fixed: value в КОПЕЙКАХ (30000 = 300 ₽);
- не больше 10 штук, порядок: ближайший срок, затем меньший id;
- id ваучеров запоминаются в резерве (`loyalty_reservations.benefit_voucher_ids`, миграция `037_voucher_reservation`);
- ваучеры выключенного шаблона (`voucher_templates.active = 0`) не отдаются.

## extras.sc

`voucherId?: number` — только вместе с `op` (резерв) и подписанным токеном в `c`.

## SellHandler

1. `consumeReservation` → `{ free, cb, voucherIds }` (`backend/src/modules/loyalty/reservations.ts`).
2. Если `voucherId`: id ∈ `voucherIds`, затем `UPDATE vouchers SET used_at, receipt_id WHERE id AND user_id AND used_at IS NULL AND expires_day>=today`.
3. `changes ≠ 1` или id вне резерва или числовой код → `disputes`: `voucher_invalid | voucher_double_use`. Ваучер не гасится.
4. `loyalty_ops.voucher` = id погашенного ваучера (`String(id)`).
5. Ваучер вместе с `free`/`cb`: льготы по резерву как обычно, спор `benefit_conflict`.
6. PAYBACK ваучер НЕ возвращает (решение владельца D-01).
7. Сумма скидки по ваучеру сервером не проверяется (сверка — backlog X5).

Реализация: `backend/src/integrations/evotor/processing/SellHandler.ts` — блок гашения в начале `db.transaction(...)` внутри `handleSell`, спор `benefit_conflict` — в конце той же транзакции.

## Единицы

БД и `resolve`: `fixed` в копейках. `/api/sync` (кортеж для PWA): `fixed` в рублях (целых), `backend/src/modules/vouchers/service.ts` → `activeVouchers`.

## Откат

Выставить `VOUCHERS_IN_RESOLVE=0` (или убрать переменную) и перезапустить backend: касса перестанет получать ваучеры.
Гашение в `SellHandler` при этом остаётся рабочим, но сработать может только если касса пришлёт `sc.voucherId`,
а без списка из `resolve` она его не пришлёт.

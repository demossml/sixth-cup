# STEP-VCH-PROGRESS — backend N1–N3 (ваучеры в resolve + погашение + free_eligible)

Ветка: `vch/n1-n3` (от `main`, HEAD на старте `4839e57`).
Правило: один STEP = минимум один коммит; отчёт — `IMPLEMENTATION-VCH-REPORT.md`.

## База (STEP-V00)

| Метрика | Значение |
|---|---|
| HEAD | `4839e57 feat(admin): voucher template CRUD screen and guest card voucher state` |
| Незакоммиченные изменения на старте | нет |
| `npm run typecheck` (корень) | OK, 3 пакета |
| backend `vitest run` | **73 файла / 419 тестов / 0 падений** |
| GUARD | **14 файлов / 72 теста / 0 падений** |
| frontend-admin `vitest run` | 6 файлов / 31 тест / 0 падений |
| frontend (PWA) `vitest run` | 4 файла / 52 теста / 0 падений |
| PRE-EXISTING падения | нет |

Состав GUARD (все файлы существуют): `sell-fixture poll-service loyalty-extras loyalty-rules reservations referral card-code loyalty-voucher-redeem loyalty-welcome sync-history loyalty-payback-retry loyalty-referral-floor loyalty-game-vs-referral` (14 файлов, 72 теста).

## Отклонения от текста промпта (зафиксировано до начала работ)

1. **Номер миграции.** В промпте ожидается `036`, но `036_voucher_templates_v1.sql` уже занят предыдущей серией (шаблоны ваучеров: `active`, `image_url`, `redemption_mode`, лимиты, `voucher_redemptions`). Новая миграция — `037_voucher_reservation.sql`. Следствие: тест STEP-V01 проверяет `schema_migrations` по префиксу `037`.
2. **Часть функциональности уже существует** в другой форме (серия «подарки · реферал · ваучеры»): `vouchersForResolve` в `modules/vouchers/service.ts`, гашение в `SellHandler` (`redeemVoucher`, `voucher_redemptions`, споры `voucher_not_redeemed`, `loyalty_ops.voucher = 'v:<id>'`). Промпт задаёт иную форму (D-05 «только once», D-12 имена споров, `loyalty_ops.voucher = String(id)`, резерв несёт `benefit_voucher_ids`). Реализация приводится к промпту; тесты предыдущей серии, фиксировавшие старую форму, перечислены в «Изменённые тесты» соответствующего STEP с причиной.
3. **CRUD шаблонов (X1)** остаётся как есть (вне объёма серии), но гашение и контракт `resolve` работают по D-05: `redemptionMode` всегда `'once'`, `stackableWithFreeCup` всегда `false`.

---

## STEP-V00 — Базовая точка и файл прогресса

Статус: DONE
Коммит: (этот файл)
Что сделано: ветка `vch/n1-n3` создана; зафиксированы точные числа тестов; GUARD проверен зелёным.
Тесты: backend 419 passed; GUARD 72 passed; frontend-admin 31 passed; frontend 52 passed; typecheck OK
Изменённые тесты: нет
DEFAULT-AD-HOC: номер миграции `037` вместо `036` (см. «Отклонения» п.1)

## STEP-V01 — Миграция и флаг конфига

Статус: DONE
Коммит: см. `git log -1`
Что сделано: миграция `037_voucher_reservation.sql` (аддитивная, `ADD COLUMN benefit_voucher_ids TEXT`); в `config` добавлены `maxVouchersInResolve: 10` и `vouchersInResolve` (`VOUCHERS_IN_RESOLVE === '1'`, по умолчанию `false`).
Тесты: `vch-migration.test.ts` 4 passed; GUARD 72 passed; typecheck OK
Изменённые тесты: нет
DEFAULT-AD-HOC: номер миграции `037` (036 занят шаблонами ваучеров, см. «Отклонения» п.1)

## STEP-V02 — Сборка ваучеров для кассы (чистая функция)

Статус: DONE
Коммит: см. `git log -1`
Что сделано: `vouchersForResolve(userId, max = config.maxVouchersInResolve)` приведён к контракту промпта (`redemptionMode: 'once'`, `stackableWithFreeCup: false`, `expiresDay: number | null`, `imageUrl: null`, пропуск некорректных значений, лимит `max`); тип `ResolveVoucher` обновлён; сохранён фильтр выключенных шаблонов (`COALESCE(t.active,1)=1`) — продуктовое поведение предыдущей серии.
Тесты: `vch-contract.test.ts` (блок V02) 8 passed; полный набор 431 passed; GUARD 72 passed; typecheck OK
Изменённые тесты: `voucher-templates.test.ts` — (1) ожидание `stackableWithFreeCup: true` → `false` для контракта resolve (D-05/D-06: контракт всегда `once`, без совмещения с подарком); (2) тест «multi с исчерпанным общим лимитом не предлагается…» заменён на проверку скрытия выключенного шаблона (лимиты `max_total` в контракт resolve не входят, D-05/X1)
DEFAULT-AD-HOC: `vouchersForResolve` уже вызывается из `reservations.ts` (наследие предыдущей серии), флаг `VOUCHERS_IN_RESOLVE` вводится в STEP-V05 — промежуточный коммит отдаёт ваучеры без флага, но только в ветке `vch/n1-n3`

## STEP-V03 — Единицы fixed для PWA

Статус: DONE
Коммит: см. `git log -1`
Что сделано: `activeVouchers` отдаёт для `fixed` рубли (целые, вниз), для `percent` — значение как есть; кортеж `[id,'p'|'f',value,expiresDay]` не менялся; `frontend/` не тронут (там уже ожидаются рубли).
Тесты: `vch-contract.test.ts` (блок V03) 4 passed; полный backend 435 passed; frontend 52 passed; typecheck OK
Изменённые тесты: нет
DEFAULT-AD-HOC: нет

## STEP-V04 — Резерв несёт id ваучеров, `consumeReservation` возвращает их

Статус: DONE
Коммит: см. `git log -1`
Что сделано: тип `ConsumedBenefits { free, cb, voucherIds }` и `parseVoucherIds` в `reservations.ts`; `consumeReservation` читает `benefit_voucher_ids` и возвращает `voucherIds` во всех ветках; в `SellHandler.ts` изменена ровно одна строка (fallback-объект для не-QR).
Тесты: `vch-reservation-consume.test.ts` 5 passed; `reservations.test.ts` без правок; GUARD 72 passed; typecheck OK
Изменённые тесты: нет
DEFAULT-AD-HOC: нет

## STEP-V05 — `resolve` отдаёт ваучеры (за флагом)

Статус: DONE
Коммит: см. `git log -1`
Что сделано: `offer = config.vouchersInResolve ? vouchersForResolve(user.id) : []`; id ваучеров пишутся в `loyalty_reservations.benefit_voucher_ids` при создании резерва и при продлении своим сканом; `ALREADY_RESERVED` и числовой код всегда `vouchers: []`; в лог `loyalty resolve ok` добавлено `vouchers: N`.
Тесты: `vch-resolve.test.ts` 8 passed; полный backend 448 passed; GUARD 72 passed; typecheck OK
Изменённые тесты: `voucher-templates.test.ts` — блок «D5: ваучеры в resolve» теперь включает флаг (`config.vouchersInResolve = true` в `beforeEach`), иначе resolve по контракту D-09 отдаёт `[]`; `loyalty-gifts-clamp.test.ts` — ожидания `consumeReservation` дополнены полем `voucherIds: []` (смена возвращаемого типа в STEP-V04)
DEFAULT-AD-HOC: нет

## STEP-V06 — Погашение ваучера в `SellHandler`

Статус: DONE
Коммит: см. `git log -1`
Что сделано: `claimedVoucher = number(sc.voucherId)`; внутри транзакции перед `INSERT loyalty_ops` — проверка `reserved.voucherIds.includes(id)` и условный `UPDATE vouchers SET used_at, receipt_id WHERE id AND user_id AND used_at IS NULL AND expires_day>=?`; споры `voucher_invalid` (reasons `numeric_code` / `not_in_reservation` / `missing` / `foreign` / `expired`) и `voucher_double_use`; `loyalty_ops.voucher = String(id)`; удалён прежний путь гашения из предыдущей серии (`redeemVoucher`, `RedeemResult`, `voucher_redemptions`-журнал, спор `voucher_not_redeemed`) — он заменён контрактом D-05/D-11/D-12.
Тесты: `vch-redeem.test.ts` 9 passed; полный backend 450 passed; GUARD 72 passed; typecheck OK
Изменённые тесты: удалён `voucher-redeem-sell.test.ts` (7 тестов предыдущей серии) — фиксировал старую модель `once|multi`, `voucher_redemptions` и спор `voucher_not_redeemed`, которая заменена решениями владельца D-05 (только `once`), D-11 (гашение только id из резерва) и D-12 (имена споров); сценарии перенесены и расширены в `vch-redeem.test.ts`
DEFAULT-AD-HOC: таблица `voucher_redemptions` из миграции `036` осталась в схеме, но кодом больше не используется (удалять таблицу — деструктивная миграция, запрещено правилом 8)

## STEP-V07 — Конфликт льгот и фиксация поведения PAYBACK

Статус: DONE
Коммит: см. `git log -1`
Что сделано: спор `benefit_conflict` пишется в конце транзакции при `claimedVoucher > 0 && (claimedFree > 0 || claimedCb > 0)` (объявление `vDispute` и `redeemedVoucher` вынесено в начало транзакции ещё в STEP-V06, как требует промпт); поведение PAYBACK зафиксировано тестами D-01 (ваучер не возвращается, ни полным, ни частичным возвратом).
Тесты: `vch-redeem.test.ts` (блок V07) 5 passed, всего в файле 14; GUARD 72 passed; typecheck OK
Изменённые тесты: нет
DEFAULT-AD-HOC: нет; `git diff` по `handlePayback` пуст (проверено `git diff 230dfb2 -- SellHandler.ts | grep -c handlePayback` → 0)

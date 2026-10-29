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

# IMPLEMENTATION-VCH-REPORT — backend N1–N3

Ветка: `vch/n1-n3` (от `main` `4839e57`). Push не выполнялся (запрещено промптом).
Часть II (`evotor-app`, STEP-A00…A04) **не выполнялась**: в этой сессии доступен только репозиторий `sixth-cup`.

## 1. STEP → коммит → статус

| STEP | Коммит | Статус |
|---|---|---|
| V00 Базовая точка и файл прогресса | `230dfb2` | DONE |
| V01 Миграция и флаг конфига | `253008c` | DONE |
| V02 Сборка ваучеров для кассы | `cf383fd` | DONE |
| V03 Единицы fixed для PWA | `7c7ae9d` | DONE |
| V04 `consumeReservation` возвращает `voucherIds` | `447329e` | DONE |
| V05 `resolve` отдаёт ваучеры за флагом | `c3bce05` | DONE |
| V06 Погашение ваучера в `SellHandler` | `a6041fc` | DONE |
| V07 `benefit_conflict` + фиксация PAYBACK | `10533b5` | DONE |
| V08 `free_eligible` по умолчанию (N3) | `f7b6755` | DONE |
| V09 Документы: контракт и наблюдаемость | `14a4590` | DONE |
| V10 Полный прогон и перепроверка | этот отчёт | DONE |

## 2. Тесты до / после

| Набор | До | После |
|---|---|---|
| backend (весь) | 73 файла / 419 | **78 файлов / 460, 0 падений** |
| GUARD (14 файлов) | 72 | 72 |
| frontend-admin | 6 / 31 | 7 / 33 |
| frontend (PWA) | 4 / 52 | 4 / 52 |
| `npm run typecheck` | OK | OK (3 пакета) |

PRE-EXISTING падений не было ни на старте, ни сейчас.

## 3. Изменённые существующие тесты

| Файл | Что | Причина |
|---|---|---|
| `backend/src/__tests__/voucher-templates.test.ts` | ожидание `stackableWithFreeCup: true` → `false`; тест про `max_total` заменён на «выключенный шаблон скрывает ваучер»; блок «D5» включает `config.vouchersInResolve = true` | D-05 (контракт всегда `once`, без совмещения с подарком), D-09 (ваучеры в resolve за флагом), лимиты шаблонов вне контракта resolve |
| `backend/src/__tests__/loyalty-gifts-clamp.test.ts` | ожидания `consumeReservation` дополнены `voucherIds: []` | смена возвращаемого типа в STEP-V04 |
| `backend/src/__tests__/voucher-redeem-sell.test.ts` | **удалён** (7 тестов) | фиксировал прежнюю модель `once|multi`, журнал `voucher_redemptions` и спор `voucher_not_redeemed`; заменён контрактом D-05/D-11/D-12, сценарии перенесены в `vch-redeem.test.ts` |

## 4. DEFAULT-AD-HOC

1. **Номер миграции `037`** вместо `036` — `036_voucher_templates_v1.sql` уже занят предыдущей серией (шаблоны ваучеров).
2. `vouchersForResolve` уже вызывался из `reservations.ts` до серии; флаг введён в STEP-V05, поэтому промежуточные коммиты ветки отдавали ваучеры без флага (прод не деплоился с ветки).
3. Сохранён фильтр `voucher_templates.active = 1` в контракте resolve — иначе гость видит ваучер, который касса всё равно не погасит (поведение предыдущей серии, противоречий с D-05 нет).
4. Таблица `voucher_redemptions` из миграции `036` осталась в схеме, но кодом не используется: удаление — деструктивная миграция (правило 8).
5. STEP-V08: тест «эвристика для не-напитка» задаёт `icon: 'Box'`, потому что схема админки по умолчанию ставит `icon='Coffee'`, а `looksLikeDrink` считает напитком уже по иконке.

## 5. Миграции

- `backend/src/db/migrations/037_voucher_reservation.sql` — единственная, аддитивная: `ALTER TABLE loyalty_reservations ADD COLUMN benefit_voucher_ids TEXT`.

## 6. Проверка 20 пунктов (STEP-V10, проход 1)

| # | Пункт | Результат |
|---|---|---|
| 1 | `npm run typecheck` | [x] 3 пакета OK |
| 2 | backend vitest | [x] 460 passed, 0 падений, ≥ базы |
| 3 | GUARD | [x] 72 passed |
| 4 | frontend-admin | [x] 33 passed (база 31) |
| 5 | frontend | [x] 52 passed |
| 6 | `vouchersForResolve` вызывается только в `reservations.ts` | [x] |
| 7 | `voucherIds` только в `reservations.ts` и `SellHandler.ts` | [x] |
| 8 | Хунки в `SellHandler.ts` | [x] импорт, `claimedVoucher`, `vDispute`/`redeemedVoucher`, гашение перед `INSERT loyalty_ops`, `benefit_conflict`, fallback `consumeReservation`; `handlePayback` не тронут (`git diff 230dfb2 -- SellHandler.ts \| grep -c handlePayback` → 0) |
| 9 | Запрещённые пути в диффе | [x] нет `PollService`, склада, `queue`, `proof.ts`, auth, game, `sync/routes.ts`, `frontend/`, APK |
| 10 | Миграция единственная и аддитивная | [x] одна `ADD COLUMN` |
| 11 | Флаг выключен по умолчанию | [x] `vch-migration.test.ts` |
| 12 | С выключенным флагом `vouchers: []` | [x] `vch-resolve.test.ts` №1 |
| 13 | 9 сценариев V06 + 5 сценариев V07 выполняются | [x] `vch-redeem.test.ts` — 14 passed, имён с skip нет |
| 14 | `it.skip` / `it.todo` / `.only` в новых файлах | [x] отсутствуют |
| 15 | Изменённые существующие тесты перечислены | [x] см. §3 |
| 16 | fixed: рубли в PWA, копейки в resolve | [x] `vch-contract.test.ts` |
| 17 | Оба docs созданы, SQL выполняется | [x] 6 запросов проверены на временной БД |
| 18 | Прогресс по каждому STEP | [x] `STEP-VCH-PROGRESS.md`, 10 записей DONE |
| 19 | STEP = коммит | [x] 10 коммитов V00–V09 + этот отчёт |
| 20 | `ANDROID_INTEGRATION_CONTRACT.md` и прочие документы не тронуты | [x] диффа по ним нет |

## 7. Что не делали и почему

- **X1** шаблоны ваучеров (CRUD, картинка, лимиты) — вне объёма серии; CRUD из предыдущей серии остаётся, но контракт `resolve` отдаёт `redemptionMode: 'once'` и `stackableWithFreeCup: false`, `imageUrl: null`.
- **X2** текст WELCOME — решение D-04.
- **X3** поздний ввод реферального кода и антифрод — вне объёма.
- **X5** сверка суммы скидки по ваучеру с документом Эвотора — не реализована, сервер сумму не проверяет.
- **Возврат ваучера при PAYBACK** — не реализован (D-01/D-02), зафиксирован тестами.
- **Массовый UPDATE `free_eligible`** — не делали (D-03), только дефолт при создании и массовая операция в админке.

## 8. Включение на проде (для владельца)

| Шаг | Что | Условие |
|---|---|---|
| T0 | SQL из `docs/LOYALTY-OBSERVABILITY.md`, таблица «касса → версия APK» | результат вписать в `PLAN-10-EVIDENCE.md` |
| T1 | Выложить APK 5.2.10 (N2) на все рабочие кассы | до включения ваучеров на backend |
| T2 | Выложить backend; `VOUCHERS_IN_RESOLVE` **не задана** | ваучеры кассе ещё не отдаются |
| T3 | Проверить `cups_without_gift`; при `> 0` — админка → Товары → массовое действие «подарок» (**не SQL**) | D-03 |
| T4 | Включить `VOUCHERS_IN_RESOLVE=1`, перезапустить; smoke на **тестовой** карте: QR → ваучер в окне → чек → `vouchers.used_at` не NULL, `loyalty_ops.voucher` заполнен, повтор невозможен | resolve создаёт резерв на 90 с и блокирует карту |
| T5 | 48 часов следить за `voucher_double_use`, `voucher_invalid`, `benefit_conflict` | Откат: `VOUCHERS_IN_RESOLVE=0` + перезапуск |

## 9. Известные ограничения

- Сумма скидки по ваучеру сервером не проверяется (сверка — X5).
- `imageUrl` в контракте всегда `null`.
- Возврат ваучера при PAYBACK не реализован.
- Ваучеры отдаются только при `VOUCHERS_IN_RESOLVE=1`; при снятии флага касса получает `[]`.
- Часть II (APK) не выполнялась.

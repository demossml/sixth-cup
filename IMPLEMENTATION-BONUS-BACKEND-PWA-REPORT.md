# IMPLEMENTATION-BONUS-BACKEND-PWA-REPORT

Дата: 16.11.2026. Серия PROMPTS-BONUS-BACKEND-PWA-SEQUENTIAL (STEP-0 … STEP-9).

```
HEAD before/after: 3165470 → 736c60b (feat(loyalty): phone register, global/individual cashback %, full-balance spend)
Migrations:        071_loyalty_bonus.sql (loyalty_settings, users.bonus_percent_bps/pd_consent_at/pd_consent_version/phone_bound_at, bonus_percent_audit)
Flags:             LOYALTY_BONUS_MODE (default '1' = бонусный контур; '0' = старые чашки)
Endpoints:         POST /api/devices/customers/lookup, POST /api/devices/customers/register,
                   POST /api/devices/loyalty/resolve (code|phone),
                   GET /api/loyalty/ledger,
                   GET|PUT /api/admin/loyalty/settings,
                   PUT /api/admin/customers/:id/bonus-percent,
                   GET /api/admin/customers/:id/ledger,
                   GET /api/admin/customers?query= (телефон/карта/id)
SellHandler earn base rule: earn = floor(полнаяСуммаЧека × bps / 10000) и ТОЛЬКО при appliedCb = 0
                   (списал хоть копейку — начисления за чек нет; FIX 16.11.2026),
                   строка журнала EVOTOR_BONUS_EARN; PAYBACK сторнирует earn пропорционально доле возврата
Spend cap:         100% of check (min(баланс, сумма чека))
Admin UI:          yes (раздел «Бонусы» + блок бонусов в карточке клиента)
PWA:               yes (баланс в шапке вместо чашек, история /api/loyalty/ledger)
Tests:             1053 backend + 145 frontend + 267 frontend-admin passed (typecheck 3/3)
WHAT I DID NOT DO:  SMS-верификация, изменения APK-кассы, физический Эвотор, конвертация старых
                   free-чашек в ₽, удаление cards.paid_total; push в remote не делал
```

## STEP-0 — Baseline

- HEAD `3165470`, typecheck 3/3, backend 1033 passed, gift-тесты 12 passed.
- Снят слепок текущего поведения подарочного контура (он остаётся рабочим при `LOYALTY_BONUS_MODE=0`).

## STEP-1 — Флаг, миграция, настройки

- `backend/src/config.ts`: `loyaltyBonusMode = (LOYALTY_BONUS_MODE ?? '1') === '1'`.
- `071_loyalty_bonus.sql`: настройки + поля пользователя + аудит процента.
- `modules/loyalty/settings.ts`: `getGlobalEarnBps`, `effectiveEarnBps`, `earnSourceOf`,
  `bpsToPercent`, `percentToBps`, `earnKopecks`, `setGlobalEarnBps`, `setUserBonusBps`
  (все чтения терпимы к старой БД без миграции). 7 тестов.

## STEP-2 — Телефон и клиенты

- `modules/loyalty/phone.ts`: `isGuestPhone`, `normalizePhoneRu`, `maskPhone`
  (`+7 ••• ••• 45 67`), `nicknameFromPhone`, `samePhone`. 10 тестов.
- `modules/loyalty/customers.ts`: `CustomerView` **без сырого телефона**
  (`phoneMasked`), `findUserByPhone`, `customerByPhone`, `registerByPhone`
  (400 без `pdConsent === true` и версии согласия, идемпотентно), `ledgerForUser`. 8 тестов.

## STEP-3 — Кассовые эндпоинты

- `POST /api/devices/customers/lookup` (лимит 120/мин на устройство) — только чтение.
- `POST /api/devices/customers/register` (лимит 30/мин) — выдача карты по телефону.
- `POST /api/devices/loyalty/resolve` принимает `{ code?, phone? }`. 8 тестов.

## STEP-4 — Контракт resolve

- В ответе `resolve` появились `balanceKopecks`, `effectiveEarnPercent`;
  `freeAvailable = 0` в бонусном режиме; `canRedeem` считается по балансу.
- Полный backend-прогон зелёный после шага.

## STEP-5 — SELL / PAYBACK

- `SellHandler`: `spendCapKopecks = min(баланс, сумма чека)`, `appliedCb` режется сервером;
  `earn` считается от `amount − appliedCb`; в бонусном режиме `cards.paid_total/free_used`
  не двигаются (только `seq`), журнал пишется двумя строками (SPEND и EARN).
- `handlePayback`: пропорциональное сторно `EVOTOR_BONUS_EARN` по доле возврата,
  недобор → спор `bonus_earn_reversal_shortfall`, баланс не уходит в минус.
- `loyalty-bonus-sell.test.ts` (11 тестов): 5 % с 1000 ₽, индивидуальные 7,5 %, списание
  всей суммы, clamp по балансу, идемпотентность поллинга, отсутствие подарочных чашек,
  полный/частичный возврат, двойное сторно, потраченный баланс.
- Подарочные тесты (`reservations`, `loyalty-gifts-clamp`, `vch-redeem`, `sell-fixture`,
  `poll-service`, `loyalty-referral-accrual`, `loyalty-payback-nosc`) закреплены на
  `LOYALTY_BONUS_MODE='0'`: они проверяют старый контур, бонусный покрыт отдельными файлами.

## STEP-6 — Admin API

- `GET|PUT /api/admin/loyalty/settings` (`earnPercent` 0–100, аудит `loyalty-settings`).
- `PUT /api/admin/customers/:id/bonus-percent` (`percent: number | null`, пишет
  `bonus_percent_audit`), `GET /api/admin/customers/:id/ledger`.
- `GET /api/admin/customers?query=…` ищет по телефону в любом формате, карте, id;
  в списке и карточке появились `bonusPercent`, `effectivePercent`, `earnSource`, `phoneMasked`.
- viewer — `403` на изменения процента. 9 тестов (`loyalty-bonus-admin-api.test.ts`).

## STEP-7 — Admin UI

- Новая страница «Бонусы» (`frontend-admin/src/pages/Loyalty.tsx`): глобальный процент,
  сохранение, подсказка про выключенный флаг, справка «как это работает».
- Карточка клиента: KPI «Баланс бонусов», «Начисляется», «Индивидуальный», поле процента
  с «Сохранить»/«Сбросить», список «Движения бонусов».
- Маршрут `/loyalty` + пункт меню в разделе «Управление».
- Component-тестов в админке нет (только unit-тесты `lib/*`), поэтому UI проверен
  typecheck'ом и вручную через API; `npm test -w frontend-admin` — 267 passed.

## STEP-8 — PWA

- `/api/sync` → `me.bonusMode`, `me.effectiveEarnPercent`; `stateView` отдаёт оба поля.
- Главная: при `bonusMode` в шапке баланс в ₽ («У вас 125 ₽ бонусов»), строка
  «Начисляем 5 % с покупки · платить можно до 100 %», прогресс чашек и марки скрыты.
  QR и код карты остались как были.
- История: блок «Бонусы» с балансом и последними 20 движениями из `GET /api/loyalty/ledger`
  (подписи на клиенте, внутренние коды не показываются).
- Телефон для существующего гостя не требуется (регистрация по телефону — только с кассы).

## STEP-9 — Документация и прогон

- `docs/BONUS-LOYALTY.md` — контракт lookup/register/resolve/sell, правило earn base,
  потолок списания 100 %, настройки, миграции, ограничения.
- `npm run typecheck` — 3/3 успешно.
- `npm test -w backend` — 138 файлов, **1053 passed**.
- `npm test -w frontend` — 145 passed, `npm test -w frontend-admin` — 267 passed.

## Commit

`feat(loyalty): phone register, global/individual cashback %, full-balance spend`

Push не выполнялся: владелец его не запрашивал.

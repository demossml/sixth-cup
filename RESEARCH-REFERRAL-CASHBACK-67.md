# RESEARCH: кэшбэк «пригласи друга» (PWA + backend), 05.11.2026

> Только исследование: код не менялся, миграции не запускались, прод-БД не трогалась.
> Все пути — от корня `sixth-cup`. Проверка на локальной БД `backend/data/sixth-cup.db` (read-only)
> и на тестовых БД во временных каталогах.

## 1. Executive summary

- Механика **реализована целиком** (UI → API → БД → баланс) и покрыта тестами: приглашение сохраняется,
  `users.invited_by` проставляется, 3 % от покупок друга начисляются и попадают в `cashback_ledger`
  и `users.cashback_balance`, история и админка их видят.
- Обрыв — **не в коде начисления, а на входе в цепочку**. Главные причины, по коду:
  1. **Ссылка приглашения игнорируется, если в браузере уже есть карта** (`sc-jwt`): `captureInvite()`
     в этом случае молча ничего не сохраняет и **не показывает никакого сообщения**
     ([main.tsx:20](frontend/src/main.tsx), [invite.ts:47](frontend/src/lib/invite.ts)). Друг, который
     хоть раз открыл PWA, «приглашён» уже не будет — и оба участника об этом не узнают.
  2. **Единственный канал, который в проде реально начисляет, — обработка SELL из Evotor** (APK не
     вызывает `/api/devices/sales` и `/api/devices/sync`, см. [docs/LOYALTY-CHANNELS.md](docs/LOYALTY-CHANNELS.md)).
     Если poll стоит на паузе `not_installed` (такие строки были в логах сервера:
     `evotor poll paused (not_installed cooldown) stores=1`, см.
     [PollService.ts:482-490](backend/src/integrations/evotor/sync/PollService.ts)), то в БД не появляется
     ни один SELL → нет ни стаканов, ни реферальных 3 %.
  3. **Начисление требует, чтобы друг показал карту в чеке** (`extras.sc.c`). Покупка «мимо кассы»
     (без QR/номера) не даёт ничего, а в PWA это никак не объяснено как условие.
- Плюс два продуктовых пробела: нет состояния «ожидает/начислено» для пригласившего (блок «От друзей»
  просто отсутствует до первого начисления) и нет ручного ввода кода приглашения (только ссылка/QR).
- Оффер в коде один и фиксированный: **пригласивший получает 3 % кэшбэка с каждой оплаты друга**;
  приглашённый не получает отдельного бонуса за регистрацию (только стандартную программу: 6-й стакан
  в подарок + WELCOME-ваучер на первой оплате).

## 2. Оффер as-is (из кода, не выдумано)

| Кто | Что получает | Когда | Где в коде |
|---|---|---|---|
| Пригласивший | `floor(3 % × (сумма чека − списанный кэшбэк))`, в копейках | после **каждой оплаты** приглашённого (не один раз) | [config.ts:32](backend/src/config.ts), [rules.ts:5](backend/src/modules/loyalty/rules.ts), [SellHandler.ts:308-320](backend/src/integrations/evotor/processing/SellHandler.ts) |
| Пригласивший | Сторно начисления | при возврате (PAYBACK) чека друга, в пределах текущего баланса | [SellHandler.ts:413-445](backend/src/integrations/evotor/processing/SellHandler.ts) |
| Приглашённый | Своя карта + обычная программа (6-й стакан в подарок, WELCOME-ваучер на первой платной чашке) | сразу после регистрации по ссылке | [auth/service.ts:7-32](backend/src/modules/auth/service.ts), [SellHandler.ts:300-303](backend/src/integrations/evotor/processing/SellHandler.ts) |
| Приглашённый | Отдельного реферального бонуса/скидки **нет** | — | в `registerUser` начислений нет |

Флага включения нет: `referralCashbackPercent: 3` — константа (не env), `REFERRAL_ENABLED` в репозитории
отсутствует.

## 3. Цепочка UI → API → БД → баланс

### 3.1 Приглашающий: получить ссылку

1. Экран `/invite` — [InvitePage.tsx](frontend/src/pages/InvitePage.tsx:15):
   `link = ${location.origin}/?invite=${encodeURIComponent(me.inviteCode)}`; QR на этот же URL (стр. 68).
   Кнопка «Поделиться» — `navigator.share`, иначе `clipboard.writeText` (стр. 17-29).
2. Вход на экран: титул «Пригласить друга» ([CardPage.tsx:214](frontend/src/pages/CardPage.tsx)),
   профиль ([ProfilePage.tsx:157](frontend/src/pages/ProfilePage.tsx)), «Ещё» ([MorePage.tsx:35](frontend/src/pages/MorePage.tsx)),
   промо-экран ([PromosPage.tsx:25,61](frontend/src/pages/PromosPage.tsx)).
3. `me.inviteCode` приходит только из `POST /api/sync` ([sync/routes.ts:82-86](backend/src/modules/sync/routes.ts)).
   `GET /api/loyalty/card` его не отдаёт и PWA его не вызывает.

### 3.2 Приглашённый: привязка

4. `main.tsx:20` — `captureInvite(location.search, !!getJwt())`, затем параметр вырезается из адресной
   строки (`history.replaceState`). Правила — [invite.ts:38-54](frontend/src/lib/invite.ts):
   - сохраняется в `localStorage['sc-invite']` = `{code, at}` **только если JWT отсутствует**;
   - TTL 14 дней ([invite.ts:12](frontend/src/lib/invite.ts));
   - формат кода `^[A-Za-z0-9_-]{4,40}$`.
5. Первый рендер защищённых маршрутов → `RequireSession` → `ensureGuest()`
   ([App.tsx:36-44](frontend/src/App.tsx), [ensureGuest.ts:13-37](frontend/src/lib/ensureGuest.ts)):
   `POST /api/auth/guest { inviteCode }`.
6. Сервер — [auth/routes.ts:31-45](backend/src/modules/auth/routes.ts):
   rate-limit `30/час` на IP, затем `createGuestUser(invite)`.
7. [auth/service.ts:7-32](backend/src/modules/auth/service.ts): поиск `users.id` по `invite_code`
   (неизвестный код → `400 «Неверный код приглашения»`), `INSERT INTO users(..., invited_by)`,
   лог `guest registered {user, invitedBy, withInvite}`. Код карты как приглашение не принимается
   (покрыто тестом). Ответ: JWT (180 дней).

### 3.3 Начисление (три канала в коде)

| Канал | Файл | Условие | Идемпотентность |
|---|---|---|---|
| Evotor poll (SELL) — **единственный живой в проде** | [SellHandler.ts:308-320](backend/src/integrations/evotor/processing/SellHandler.ts) | `amount > 0` и `users.invited_by` | PK `loyalty_ops(doc_store, doc_id)` |
| Online sale (`POST /api/devices/sales`) | [sales.ts:82-89](backend/src/modules/devices/sales.ts) | `net > 0` и `invited_by` | `receipts.id = "<deviceId>:<fiscalId>"` |
| Receipt-sync (`POST /api/sync`, `/api/devices/sync`) | [receipts.ts:91-102](backend/src/modules/loyalty/receipts.ts) | `r.a > 0` и `invited_by` | `receipts.id = "<deviceId>-…"` |

Пишут: `users.cashback_balance += bonus`, `cashback_ledger(beneficiary_id, from_user_id, receipt_id, amount)`
и (если у пригласившего есть `card_id`) строку `loyalty_ledger` с `source_type='REFERRAL'`.

### 3.4 Чтение и показ

8. `friendsView()` — [cardLookup.ts:32-39](backend/src/modules/loyalty/cardLookup.ts): `fromFriendsKopecks`
   = `SUM(cashback_ledger.amount)` без `receipt_id LIKE 'game:%'`; `friendsCount` = число
   `users WHERE invited_by = me`. Попадает в `me` через `stateView()` в `POST /api/sync`
   ([sync/routes.ts:86](backend/src/modules/sync/routes.ts)).
9. PWA: титул, блок «От друзей +N ₽ / M друзей» — [CardPage.tsx:222-231](frontend/src/pages/CardPage.tsx)
   (показывается только если `friendsCount > 0 || fromFriendsKop > 0`).
   Кэшбэк-баланс — строка «Кэшбэк … ₽» на карте-пропуске и в профиле ([ProfilePage.tsx:97](frontend/src/pages/ProfilePage.tsx)).
   История — строка `referral` «Кэшбэк от покупок друга» ([sync/routes.ts:52-56](backend/src/modules/sync/routes.ts)).
10. Админка: «Рефералка» — [Referrals.tsx](frontend-admin/src/pages/Referrals.tsx), API
    `GET /api/admin/analytics/referrals/summary` ([analytics.ts:221-320](backend/src/modules/admin/analytics.ts));
    построчные начисления — карточка клиента.

### 3.5 Что говорит локальная БД

`backend/data/sixth-cup.db` (read-only): `users=5`, из них `invited_by IS NOT NULL` — 1 (`id=2 → invited_by=1`),
`cashback_ledger` — 0 строк, `loyalty_ops` SELL — 0, `receipts` — 0.
То есть **привязка работает, начислять было не с чего** (в этой БД нет ни одной обработанной продажи).
Прод-БД на этой машине недоступна — запросы для владельца в §7.

## 4. Корневые причины обрыва (по гипотезам из задания)

**1. UI только копирует ссылку, API не вызывается — ОПРОВЕРГНУТО.**
`main.tsx:20` → `ensureGuest` → `POST /api/auth/guest { inviteCode }`; тест `referral.test.ts`
«full client scenario» проверяет связку storage → регистрация → `invited_by`.

**2. API есть, но фронт не шлёт код — ОПРОВЕРГНУТО.** См. `ensureGuest.ts:16-21`.

**3. Accept не привязывает `invited_by` — ОПРОВЕРГНУТО.** `auth/service.ts:9-22`, тест
`referral.test.ts` «binds the friend to the inviter».

**4. Начисление только после продажи, poll не создаёт ledger — ПОДТВЕРЖДЕНО (главная причина).**
Начисления только в трёх каналах продаж; из них APK использует единственный — фискальный чек Эвотора,
который появляется в БД только если:
   - poll сервера не на паузе. В логах владельца было `evotor poll paused (not_installed cooldown) stores=1`
     ([PollService.ts:482-490](backend/src/integrations/evotor/sync/PollService.ts)) — пауза 15 минут
     после каждого `not_installed`; пока токен Эвотор не «установлен», документы не читаются вообще;
   - в чеке есть `extras.sc.c` (гость показал карту) — иначе `handleSell` выходит с
     `reason: 'no loyalty extra'` ([SellHandler.ts:173-174](backend/src/integrations/evotor/processing/SellHandler.ts));
   - сумма чека > 0 в правильном масштабе.

**5. Флаг/env выключен — ОПРОВЕРГНУТО.** Константа 3 % в `config.ts:32`, env-флага нет.

**6. Deep link теряется — ПОДТВЕРЖДЕНО ЧАСТИЧНО, и это причина №2 по значимости.**
   - `captureInvite(..., !!getJwt())`: если в браузере уже есть `sc-jwt` (друг когда-то открывал PWA),
     код **не сохраняется**, ссылка вырезается, никакого сообщения нет ([invite.ts:47](frontend/src/lib/invite.ts)).
     При этом друг не может «привязаться» позже ни через сброс карты
     (`ProfilePage.tsx:75-82` явно делает `clearInvite()`), ни вручную — **UI ввода кода приглашения
     в приложении отсутствует** (grep по `inviteCode` в `frontend/src` даёт только чтение из `me`).
   - Открытие установленной PWA с иконки (`start_url: '/'`) теряет `?invite=`.
   - Код старше 14 дней отбрасывается.
   - Код неизвестен серверу → 400, клиент молча перерегистрируется без реферера ([ensureGuest.ts:24-26](frontend/src/lib/ensureGuest.ts)).
   Что **не** теряется: сервер отдаёт `index.html` без редиректа (`app.ts:227-232`), `index.html` с
   `Cache-Control: no-cache`, SW-фолбэк сохраняет query — то есть при нормальном переходе по ссылке
   параметр доезжает.

**7. Начисление есть в БД, UI не читает — ОПРОВЕРГНУТО.** `friendsView` → `me.fromFriendsKopecks` →
`CardPage.tsx:229`; история — `sync/history` строка `referral`.

### Дополнительно найдено (в задании не перечислено)

- **Нет состояния «ожидает»**: до первого начисления блок «От друзей» не рисуется вообще
  (`CardPage.tsx:222`), на экране приглашения нет ни списка друзей, ни «приглашено N / купили M».
  Пригласивший видит ровно ничего → «не работает».
- **`/api/auth/guest` ограничен 30 запросами в час на IP** ([auth/routes.ts:37](backend/src/modules/auth/routes.ts)).
  За мобильным CGNAT пачка регистраций упрётся в 429, а клиент любую ошибку сводит к `'offline'`
  ([ensureGuest.ts:34-36](frontend/src/lib/ensureGuest.ts)) и показывает «Нужен интернет один раз».
- **Админ-метрики периода не соблюдают**: `invited`/`active` считаются по всей истории
  (`analytics.ts:227-241`), период влияет только на `bonusKop`; «С покупкой» определяется **только**
  по `loyalty_ops.kind='SELL'` ([analytics.ts:292-304](backend/src/modules/admin/analytics.ts)),
  поэтому покупка, пришедшая каналом online-sale или receipt-sync, оставит статус «ожидание»
  при уже начисленном бонусе.
- **Канал receipt-sync фактически мёртв**: токены `t:'r'` в проде никто не минтит — сервер подписывает
  только карточные `t:'c'` ([proof.ts:66-79](backend/src/modules/loyalty/proof.ts)), а `signToken`
  вызывается лишь оттуда; в коде репозитория `t:'r'` встречается только в тестах.
- **Самоприглашение/фарм не ограничено**: проверяется только наличие JWT, поэтому «пригласить себя»
  из приватного окна и платить «своей» второй картой → 3 % с собственных покупок. Лимита на число
  друзей, проверки устройства/IP или «первой покупки друга» нет.
- **«От друзей» — это lifetime-сумма начислений**, а не остаток: списанный кэшбэк из этой суммы не
  вычитается (`cardLookup.ts:34-38`), тогда как баланс (`cashback_balance`) уменьшается. Числа на
  экране расходятся, если гость тратил кэшбэк.
- **База процента разная по каналам**: Evotor — `amount − appliedCb`, receipt-sync — полная `r.a`,
  online-sale — `net`. Мелочь, но цифры могут отличаться на копейки.

## 5. Что уже покрыто тестами (и проходит локально)

Прогон: `DB_PATH=$(mktemp -u /tmp/refr-XXXX.db) npx vitest run src/__tests__/referral.test.ts
src/__tests__/loyalty-referral-accrual.test.ts src/__tests__/loyalty-referral-floor.test.ts
src/__tests__/loyalty-game-vs-referral.test.ts` → **4 файла, 22 теста, все зелёные**.

| Файл | Что проверяет |
|---|---|
| [referral.test.ts](backend/src/__tests__/referral.test.ts) | клиентский store (TTL, отказ при наличии аккаунта, мусор), привязка `invited_by`, код карты ≠ код приглашения, неизвестный код → retry без него, диагностический лог без утечки кода, `fromFriendsKopecks` в `/api/sync` |
| [loyalty-referral-accrual.test.ts](backend/src/__tests__/loyalty-referral-accrual.test.ts) | 3 % при SELL, отсутствие начисления без `invited_by`, повторный poll не дублирует, база уменьшается на списанный кэшбэк, сторно при PAYBACK, строка `referral` в истории, построчные начисления в карточке клиента |
| [loyalty-referral-floor.test.ts](backend/src/__tests__/loyalty-referral-floor.test.ts) | сторно не уводит баланс в минус (L-01) |
| [loyalty-game-vs-referral.test.ts](backend/src/__tests__/loyalty-game-vs-referral.test.ts) | игровые награды не попадают в «От друзей» |

Чего нет:
- теста на реальный путь «друг открыл ссылку в браузере, где уже есть карта» (сейчас это тихий отказ — надо зафиксировать поведение);
- e2e «приглашение → SELL → отображение на титуле» через HTTP (сейчас SELL подаётся прямым вызовом `handleSell`);
- теста аналитики `/referrals/summary` на смешанные каналы (online-sale/receipt-sync);
- теста на 429 от `/api/auth/guest` и на сообщение пользователю.

## 6. Рекомендуемый план фикса (только план)

### P0 — чтобы «приглашение» перестало молча теряться

1. **Не выбрасывать приглашение при наличии карты**: сохранять код в `sc-invite` всегда, а решать
   на сервере/в UI, применять ли его. Минимальный вариант без смены модели: сохранять код и
   показывать на титуле честную плашку «Вы открыли приглашение, но у вас уже есть карта — бонус
   начисляется только новым гостям», с кнопкой «Сбросить карту и начать по приглашению»
   (осознанный путь через `doReset`).
2. **Ручной ввод кода** на экране `/invite` и в онбординге (поле + `POST /api/auth/guest`
   для новых гостей или «привязать к текущей карте», если решим разрешать привязку существующей
   карты — см. open questions).
3. **Состояние «ожидает/начислено» в PWA**: в `friendsView` уже есть `friendsCount`; добавить
   `friendsWithPurchases` (по `loyalty_ops`/`cashback_ledger`) и показывать на `/invite`:
   «приглашено N · купили M · начислено X ₽». Плюс блок «От друзей» на титуле показывать при
   `friendsCount > 0` даже с нулевой суммой.
4. **Диагностика регистрации**: в админку «Рефералка» — колонка `withInvite` из лога/поля и счётчик
   «переходов по ссылке без привязки» (сейчас такие переходы не видны нигде).

### P0 — чтобы начисление вообще происходило

5. **Проверить и починить канал Evotor**: статус `not_installed` в `evotor_sync_state.status/last_error`,
   установка приложения в кабинете Эвотор. Без этого ни стаканы, ни 3 % не пишутся — это не баг
   рефералки, а отсутствие входных данных.
6. **Объяснить условие в UI**: «кэшбэк начисляется, когда друг платит и показывает карту». Сейчас
   на `/invite` этого нет.
7. **Согласовать статусы в админке**: «С покупкой» считать по `cashback_ledger` (любой канал), а не
   только по `loyalty_ops`; KPI `invited/active` — фильтровать по периоду, как `bonusKop`.

### P1

8. Антифарм: лимит числа «друзей» и/или начислений в месяц, проверка «друг ≠ та же карта/устройство»,
   начисление только с **первой** покупки друга (или после N дней) — как продуктовое решение.
9. Единая база процента во всех каналах (`amount − appliedCb` везде).
10. «От друзей» показывать как «начислено за всё время» + отдельно остаток, чтобы не расходилось с балансом.
11. Разобраться с каналом receipt-sync: либо APK печатает и подписывает `t:'r'`, либо канал убрать из
    документации как неактивный.
12. Тесты: сценарий «ссылка при наличии карты», e2e-начисление через HTTP, аналитика на смешанные каналы.

## 7. Open questions владельцу (блокирующие)

1. **Разрешаем ли привязку приглашения к уже существующей карте?** Сейчас — нет (и это осознанно
   задокументировано в `invite.ts`). Это меняет и антифарм-риски, и оффер. Без ответа нельзя
   выбирать между «плашка + сброс карты» и «привязывать к текущей карте».
2. **Начислять только с первой покупки друга или с каждой?** В коде — с каждой, бессрочно
   (`SellHandler.ts:308`). Если оффер другой — нужен явный ответ, чтобы не менять экономику молча.
3. **Что делать с уже «потерянными» приглашениями** (друзья, зарегистрированные без `invited_by`)?
   Ручная привязка в админке (по номеру карты) или признаём безвозвратными.
4. **Доступ к прод-БД для проверки** — нужны результаты:
   ```sql
   SELECT COUNT(*) FROM users WHERE invited_by IS NOT NULL;                       -- привязки
   SELECT status, last_error, COUNT(*) FROM evotor_sync_state GROUP BY 1,2;        -- жив ли poll
   SELECT COUNT(*) FROM loyalty_ops WHERE kind='SELL';                             -- обработанные продажи
   SELECT COUNT(*), COALESCE(SUM(amount),0) FROM cashback_ledger;                  -- начисления
   SELECT id, invited_by, card_code, cashback_balance FROM users WHERE invited_by IS NOT NULL ORDER BY id DESC LIMIT 20;
   ```
   (только чтение; выполнять владельцу/на проде)

# P0b — рефералка: UI и вход (invite не терять молча)

Дата: 05.11.2026. Область: `frontend` guest PWA + один файл тестов backend (frontend-модули).
Процент 3 %, `SellHandler`, poll Evotor, касса — не трогались. Авто-привязки invite к существующей
карте нет.

## 1. Diff

| Файл | Что изменилось |
|---|---|
| [frontend/src/lib/invite.ts](frontend/src/lib/invite.ts) | `captureInvite` теперь возвращает `{ strip, stored, ignored }` — валидный код при существующей карте не пропадает; добавлены `storeInvite`, `isValidInviteCode`, `parseInviteInput` (код или целая ссылка) и хранилище сообщений `setInviteNotice` / `getInviteNotice` / `clearInviteNotice` (TTL 7 дней) |
| [frontend/src/main.tsx](frontend/src/main.tsx) | `captured.ignored` → `setInviteNotice({kind:'ignored'})` перед рендером; query по-прежнему вырезается |
| [frontend/src/lib/ensureGuest.ts](frontend/src/lib/ensureGuest.ts) | `GuestResult = 'ok' \| 'offline' \| 'rate_limited' \| 'invalid_invite'`; причина различается по HTTP-статусу; `applyInvite(code)` — строгое применение (ничего не создаёт при ошибке); `resetCardWithInvite(code)` — осознанный сброс карты с сохранением кода; при неизвестном коде ставится notice `rejected` |
| [frontend/src/api.ts](frontend/src/api.ts) | `unwrap` кладёт `status` в ошибку (`ApiError`), чтобы UI отличал 400 от 429 |
| [frontend/src/App.tsx](frontend/src/App.tsx) | онбординг показывается **до** создания карты (гость успевает ввести код, «брошенные» аккаунты не появляются); `invalid_invite` = карта создана (плашка объяснит); отдельный экран «Слишком много попыток» для 429 |
| [frontend/src/components/InviteNotice.tsx](frontend/src/components/InviteNotice.tsx) | новый: плашка «Вы открыли приглашение друга…» + «Начать новую карту по приглашению» (двухшаговое подтверждение) / «Понятно»; вариант «Код приглашения не принят» |
| [frontend/src/pages/CardPage.tsx](frontend/src/pages/CardPage.tsx) | плашка над картой-пропуском; блок «От друзей» показывается при `friendsCount > 0` — с `+X ₽` или «N друзей · пока без начислений» |
| [frontend/src/pages/InvitePage.tsx](frontend/src/pages/InvitePage.tsx) | блок статуса: «Приглашено N», «Начислено от друзей X ₽», человеческая подсказка под состояние; в памятке явно «кэшбэк приходит, когда друг оплачивает на кассе и показывает карту» |
| [frontend/src/pages/OnboardingPage.tsx](frontend/src/pages/OnboardingPage.tsx) | «У меня есть код друга» → поле + «Применить»: валидация формата, приём кода или целой ссылки, немедленная привязка (`applyInvite`), тексты для «не найден / нет сети / слишком много попыток», поле блокируется после успеха |
| [backend/src/__tests__/referral.test.ts](backend/src/__tests__/referral.test.ts) | тесты фронтового модуля обновлены под новую сигнатуру + новые кейсы: `ignored` при существующей карте, нормализация ручного ввода, TTL/снятие сообщения |

Backend-кода не меняли: `friendsCount` уже отдавался в `POST /api/sync` (`stateView().friendsView`).

## 2. Поведение трёх сценариев

### A. Новый гость по ссылке `/?invite=CODE`
1. `captureInvite` (нет JWT) → код в `sc-invite` (TTL 14 дней), query вырезается.
2. RequireSession видит «не онбордился» → `/onboarding` **без создания карты**.
3. «К карте»/«Пропустить» → `ensureGuest()` → `POST /api/auth/guest { inviteCode }` → `users.invited_by`.
4. Проверено в браузере: новый origin + `?invite=O3VR1N3K` → после онбординга в БД `invited_by=6`.

### B. Ссылка открыта в браузере, где карта уже есть
1. `captureInvite(search, true)` → `{ stored:false, ignored:'CODE' }`, код к текущему user не применяется.
2. На титуле плашка: «Вы открыли приглашение друга. Но у вас уже есть карта…» + «Понятно» и
   «Начать новую карту по приглашению».
3. «Начать новую…» → подтверждение (предупреждение о потере стаканов/кэшбэка) → `resetCardWithInvite`:
   `setJwt(null)` → `clearUserData()` → код сохраняется → `applyInvite(code)` → новый user с `invited_by`.
   Старый аккаунт не переписывается. Проверено: карта 0011 → 0012, `invited_by` = владелец кода.
4. Если код не найден — плашка с ошибкой, карта остаётся прежней.

### C. Ручной ввод кода (новый гость)
1. Онбординг → «У меня есть код друга» → поле «Код или ссылка друга».
2. Принимается и код (`ANGUO_1P`), и целая ссылка (`https://…/?invite=anguo_1p`) — нормализуется в код.
3. Битый формат → локальная подсказка без запроса; неизвестный код → 400 → «Код не найден…»,
   аккаунт **не** создаётся, можно исправить; нет сети → «Код сохранён и применится, когда появится интернет»;
   429 → «Слишком много попыток».
4. Успех → «Код принят: карта создастся уже с приглашением друга», поле блокируется.
   Проверено: `invited_by` проставлен, ответ 400 для `NOSUCHCODE` без создания user.

Дополнительно (не запрашивалось, но было прямым следствием): при неизвестном коде из **ссылки**
карта всё равно создаётся (прежнее поведение), но теперь на титуле висит плашка
«Код приглашения не принят — карта создана без приглашения» (проверено).

## 3. Что не делали (P0a)

- `referralCashbackPercent` (3 %), `SellHandler`, PAYBACK-сторно, `PollService`, касса — без изменений
  (`git status` по этим путям пуст).
- Начисление 3 % не «оптимистичное»: UI показывает только то, что вернул `/api/sync`.
- Привязка invite к уже существующей карте автоматически не делается — только через явный сброс.
- `friendsWithPurchases` (сколько друзей уже купили) не добавляли — в задаче необязательно.
- Админка (`analytics/referrals`) не менялась.

## 4. Тесты и проверки

| Проверка | Результат |
|---|---|
| `npm run typecheck` (root, 3 пакета) | OK |
| `cd frontend && npx vitest run` | 53 passed |
| `npx vitest run referral + loyalty-referral-accrual + loyalty-referral-floor + loyalty-game-vs-referral` | 25 passed (было 22, +3 новых кейса) |
| `cd frontend && npm run build` | OK, precache 35 entries |
| Новый браузер + `?invite=` | `invited_by` проставлен |
| Есть JWT + `?invite=` | плашка, авто-привязки нет |
| Сброс «с приглашением» | новый user с `invited_by`, старый цел |
| Ручной код без JWT | привязка; битый код → 400 без создания user |
| `friendsCount = 1`, kop = 0 | титул: «От друзей · 1 друг · пока без начислений» |
| 429 на `/api/auth/guest` | экран «Слишком много попыток» вместо «Нужен интернет» |

Тестовые аккаунты и записи rate-limit, созданные во время проверки, удалены из локальной dev-БД
(`backend/data/sixth-cup.db`): пользователей снова 5, как до начала работы.

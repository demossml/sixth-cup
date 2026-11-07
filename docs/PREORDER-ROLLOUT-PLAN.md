# План реализации: предзаказ PWA → касса, баннер, ETA, бан за невыкуп

Документ для агента-разработчика (backend + PWA + админка). Касса — отдельный файл
[`PROMPT-APK-PREORDER-QUEUE.md`](./PROMPT-APK-PREORDER-QUEUE.md).

Дата: 07.11.2026. Репозиторий: `sixth-cup` (main: `be682ee`).
Входной прототип: `menu-prototype/` из `index (4).zip` + `ORDER-MENU-SPEC.md`.

> **Статус: этапы A–G выполнены.** Журнал по этапам — [`PREORDER-STAGE-REPORTS.md`](./PREORDER-STAGE-REPORTS.md),
> приёмка с PASS/FAIL — [`PREORDER-UX-ACCEPTANCE.md`](./PREORDER-UX-ACCEPTANCE.md).
> Касса (`evotor-app`) — по промпту [`PROMPT-APK-PREORDER-QUEUE.md`](./PROMPT-APK-PREORDER-QUEUE.md).

---

## 0. Решения владельца (зафиксировано, не переспрашивать)

1. **Кто двигает статусы:** кассир-бариста на кассе (APK). Отдельное приложение бариста — будущее,
   в этом плане его нет. Пока касса не умеет — статусы можно двигать из админки (страховка).
2. **ETA:** приблизительное время приготовления задаётся **в админке** (на точку), обязательно.
   По умолчанию система сама переводит заказ в «готов» по таймеру; кассир может подтвердить «готов» раньше.
3. **Один активный заказ:** нельзя создать второй, пока текущий не забран и не оплачен.
4. **Бан за невыкуп:** если заказ не забрали и он не оплачен — гостю ставится бан на количество часов,
   которое указано в админке. Бан снимается автоматически по истечении срока (или вручную из админки).
5. **Главный экран (титул/карта) не перерисовываем** — только встраиваем один компактный баннер заказа.
6. Палитра — текущая (`brand #0B4A8D`, white/ice). Крем/paper `#F6F3EE` и `#002FA7` **не возвращаем**.

## 0.1. Что взято из `PLAN-AGENTS-PROMPTS.zip`, а что нет

**Берём:**
- формат серии промптов: Stage 0…N, критерий GREEN, Stage Report, финальный маркер;
- контракт `GET /api/orders/active` + `{ok:true, order|null}`;
- `409 active_order_exists` с `activeOrderId` (расширяем баном);
- идею `ActiveOrderBanner` как отдельного компонента с 4-шаговой мини-шкалой;
- идею приёмки `docs/PREORDER-UX-ACCEPTANCE.md` с PASS/FAIL/BLOCKED.

**Не берём / переделываем:**
- **Палитра** `#002FA7` + paper — противоречит текущему бренду.
- **Место баннера** «между шапкой и промо» — там у нас карта-пропуск, а TITLE-спека запрещает вставлять
  что-либо между картой и акцией. Баннер ставим **первым элементом контента, над картой-пропуском**.
- **Расширение `/api/directory` схемами** (volume/milk/choice/addons) — раздувает офлайн-кэш и дублирует
  `buildProductConfiguration`. Делаем отдельный гостевой эндпоинт схем на товар (этап P1-1).
- **«Уже сделано: APK ≥161 pull/markPaid»** — не подтверждено этим репозиторием. Считаем, что касса API
  заказов **не вызывает**, пока не проверено обратное (см. отдельный промпт кассы).
- **Store picker с картой** — в `stores` нет координат и часов. Переносим в P2, нужны данные.
- **Редизайн меню 1:1** — отдельная задача, не блокирует заказ.

---

## 1. Текущее состояние (факты из кода)

| Что | Где | Статус |
|---|---|---|
| Таблицы `preorders`, `preorder_items`, `preorder_item_modifiers` | `backend/src/db/migrations/042_preorder_orders.sql` | есть |
| State machine `draft→accepted→cooking→ready→paid` + `cancelled/rejected/expired` | `modules/orders/types.ts` | есть |
| QR `ord1.*` (HMAC), 6-значный код, TTL 30 мин | `modules/orders/service.ts:buildQrPayload`, `expireIfNeeded` | есть |
| Гость: `POST /api/orders`, `GET /api/orders/:id`, `POST /api/orders/:id/cancel` | `modules/orders/routes.ts:57-96` | есть |
| Терминал: `resolve`, `active`, `PATCH status`, `reject`, `mark-paid` (requireDevice) | `modules/orders/routes.ts:100-190` | есть |
| PWA: корзина, `CartSheet`, `OrderQrScreen` (таймлайн, опрос 5 с, отмена) | `frontend/src/lib/preorderApi.ts`, `components/order/*` | есть |
| Баннер заказа, восстановление после reload, ETA, бан | — | **нет** |
| Настройки на точку | `app_settings` + `lib/cashierMenu.ts` (образец) | есть паттерн |

---

## 2. Целевая механика (как должно работать)

```
гость собирает заказ → POST /api/orders (JWT обязателен)
   draft  ──(кассир «Принять»)──▶ accepted      eta_ready_at = now + prepMinutes
   accepted ──(авто через 60 с)──▶ cooking
   cooking ──(авто по eta_ready_at ИЛИ кассир «Готов»)──▶ ready
   ready/… ──(кассир пробил SELL + mark-paid)──▶ paid
   paid ──(гость «Я забрал»)──▶ picked_up_at (статус остаётся paid)
   draft без подтверждения и TTL истёк ──▶ expired  +  бан гостю
   accepted/cooking/ready, TTL истёк и не оплачен ──▶ expired + бан гостю
```

- `active` для баннера: `draft|accepted|cooking|ready` + `paid` пока `picked_up_at IS NULL`.
- Бан: `preorder_bans(user_id, until, reason, order_id)`; проверяется при `POST /api/orders`.
- ETA в ответе: `etaReadyAt` (ISO), `etaMinutes`, `serverNow` (ISO) — клиент считает остаток от серверного времени.

---

## 3. Серия этапов (один этап = один промпт = GREEN → следующий)

Правила для агента на каждом этапе:
- сначала `git status` (грязно → стоп), новая ветка `feature/preorder-<stage>` от `main`;
- только заявленные файлы, без «рефакторинга по дороге»;
- в конце: `npm run typecheck`, целевые тесты, полный `backend vitest`, `frontend vitest`, `admin vitest`;
- Stage Report в `docs/PREORDER-STAGE-REPORTS.md` (дописывать, не перезаписывать);
- коммит/push — по слову владельца.

---

### STAGE A — Настройки предзаказа на точку + ETA + авто-переходы (backend)

**Цель:** сервер сам считает «через сколько готово» и сам двигает статусы по таймеру.

1. Миграция `043_preorder_eta.sql` (+ rollback) — аддитивно:
   ```sql
   ALTER TABLE preorders ADD COLUMN eta_ready_at INTEGER;
   ALTER TABLE preorders ADD COLUMN picked_up_at INTEGER;
   ALTER TABLE preorders ADD COLUMN ready_by TEXT;      -- 'auto' | 'cashier'
   CREATE TABLE IF NOT EXISTS preorder_bans (
     user_id INTEGER PRIMARY KEY,
     until INTEGER NOT NULL,
     reason TEXT NOT NULL DEFAULT 'no_show',
     order_id TEXT,
     created_at INTEGER NOT NULL,
     lifted_at INTEGER
   );
   ```
2. `backend/src/lib/preorderSettings.ts` по образцу `lib/cashierMenu.ts`:
   ключ `app_settings['preorder:<storeUuid>']`, дефолты
   `{ prepMinutes: 7, noShowBanHours: 24, autoReady: true }`, валидация через zod в админке.
   Резолв storeUuid: локальный `preorders.store_id` → `devices`/`evotor_stores`… **уточнить в Stage 0**
   и зафиксировать в отчёте (в проекте два пространства: локальный `stores.id` и Evotor `store_uuid`).
3. `service.ts`:
   - `promoteIfDue(row)` рядом с `expireIfNeeded`: `accepted` старше 60 с → `cooking`;
     `cooking` и `now ≥ eta_ready_at` и `autoReady` → `ready` с `ready_by='auto'`;
   - `expireIfNeeded`: если истёк неоплаченный заказ → `expired` **и** создать бан по `guest_user_id`;
   - при `accepted` (любой источник) — `eta_ready_at = now + prepMinutes*60`;
   - `prepMinutes` = `max(storePrep, ceil(Σ products.recipe_seconds × qty / 60))`, clamp 3…30.
4. `OrderOut` + аддитивные поля `etaReadyAt`, `etaMinutes`, `serverNow`, `pickedUpAt`.
5. Админка backend: `GET /api/admin/preorder/settings?storeUuid=`, `PATCH /api/admin/preorder/settings`
   (только owner/manager; `MANAGER_BLOCKED` не расширять — это не деструктивная настройка).

**GREEN:** тесты — ETA считается и проставляется; `accepted→cooking` по времени; `cooking→ready` по ETA;
`ready_by='auto'`; настройки читаются/пишутся; старый `expireIfNeeded` не сломан.

---

### STAGE B — Активный заказ, один заказ, бан (backend)

**Цель:** гость не может плодить заказы; бан за невыкуп работает.

1. `GET /api/orders/active` (guest JWT): активный заказ (`draft|accepted|cooking|ready`,
   плюс `paid` при `picked_up_at IS NULL`) → `{ok:true, order}` / `{ok:true, order:null}`.
2. `POST /api/orders` — **JWT обязателен** (сейчас `optionalAuth`). Без JWT → `401`.
3. Проверки при create, по порядку:
   - активный заказ есть → `409 {ok:false, error:'active_order_exists', activeOrderId}`;
   - активный бан → `403 {ok:false, error:'preorder_banned', bannedUntil, message}`;
4. `POST /api/orders/:id/received` (guest): только если `paid` и не `picked_up_at` → ставит `picked_up_at`.
5. Бан: авто-создание из `expireIfNeeded`/`rejectOrder` для неоплаченных; авто-снятие по времени
   (проверка `until <= now` → бан игнорируется, запись помечается `lifted_at`).
   `POST /api/admin/preorder/bans/:userId/lift` — ручное снятие.
6. Один раз в сутки (или на чтении) чистить истёкшие баны, чтобы таблица не росла.

**GREEN:** тесты — active null/не-null по всем статусам; второй create → 409; после expired → 403 с `bannedUntil`;
после «Я забрал» → active null и новый заказ разрешён; ручное снятие бана работает; без JWT → 401.

---

### STAGE C — Данные для кассы: UUID позиций, ручной ETA, админ-страховка (backend)

**Цель:** касса может «подтянуть» заказ в чек и подтвердить статусы; если APK ещё не готов —
то же самое доступно из админки.

1. При create резолвить `evotor_uuid` по точке: позиция (объём) и платные опции
   (`milk_scheme_variants.product_id`, `modifier_scheme_options.product_id`) → `product_store_links.evotor_uuid`
   для **этого** store. Писать в `preorder_items.evotor_product_uuid` и в модификаторы
   (миграция `044`: `preorder_item_modifiers.evotor_uuid`).
2. `POST /api/devices/orders/:id/eta` (device) — кассир уточняет ETA (`etaMinutes`), пишет `eta_ready_at`.
3. Админка (страховка на время, пока APK не обновлён):
   - `GET /api/admin/preorder/orders?storeId=&status=active`,
   - `POST /api/admin/preorder/orders/:id/status` (`accepted|cooking|ready`),
   - `POST /api/admin/preorder/orders/:id/reject`, `…/mark-paid`,
   - всё с записью в `admin_audit`, роли как у остальных админ-действий.
4. Никаких изменений контракта `/api/devices/loyalty/*`.

**GREEN:** тесты — UUID резолвятся по точке и `null`, если связи нет; ручной ETA переопределяет авто;
админ-переходы валидируют state machine (409 на недопустимый переход); `admin_audit` пишется.

---

### STAGE D — PWA: баннер на главной + восстановление заказа (frontend)

**Цель:** «видно, что готовится и через сколько забирать» без переделки главного экрана.

1. `lib/preorderApi.ts`: `getActiveOrder()`, `markReceived()`, хранение `orderId`/`qrPayload`
   в `localStorage` (`sc_order_current`), очистка при terminal-статусе.
2. Новый компонент `frontend/src/components/order/ActiveOrderBanner.tsx`:
   - строки: `Заказ 123 456` / `{статус} · {остаток} · {точка}`; шеврон; мини-шкала 4 точек;
   - `draft` → «Ждём подтверждения · 29:14»; `accepted`/`cooking` → «Готовится · ~4 мин»;
     `ready` → кобальтовая заливка «Готов — забирайте»; `paid` → «Оплачен»;
   - остаток считается от `etaReadyAt` с поправкой на `serverNow`; `≤0` → «уточняем»;
   - `null` → компонент не рендерится (никакого пустого отступа);
   - `aria-label="Заказ {code}, {статус}"`, тап → `OrderQrScreen`.
3. Встройка:
   - `CardPage.tsx`: **первым элементом** `<div className="px-4 -mt-3 space-y-3">`, до `InviteNotice`
     и до карты-пропуска (правило TITLE «между картой и акцией — ничего» сохраняется);
   - `MenuPage.tsx`: над сеткой, как в прототипе.
4. Опрос `GET /api/orders/active` раз в 20 с **только при видимом экране** + на `visibilitychange`/`online`;
   после возврата с `OrderQrScreen` — refetch.
5. Офлайн: показывать последний известный статус из `localStorage`, помечать «нет сети».

**GREEN:** `frontend vitest` (новые тесты на формат статуса/остатка), `npm run build`;
`git diff` по `CardPage` — только вставка баннера (шапка/штампы/пасс не изменены);
ручная проверка: нет заказа → главная пиксельно как раньше.

---

### STAGE E — PWA: корзина/создание с баном и «Мой заказ» (frontend)

1. `409 active_order_exists` → диалог «У вас уже есть заказ» → «Мой заказ» / «Закрыть» (не молчаливый fail).
2. `403 preorder_banned` → экран/плашка «Не забрали прошлый заказ. Новый можно через N ч M мин»
   с обратным отсчётом до `bannedUntil`; CTA «Собрать заказ» disabled.
3. `OrderQrScreen`: добавить ETA-строку, «Я забрал» для `paid`, кнопку «Отменить» оставить только для `draft`.
4. Хранить выбранную точку в `localStorage` (`sc_store_id`), использовать в корзине и баннере.

**GREEN:** тесты на классификацию ошибок; ручной прогон 409/403; сборка.

---

### STAGE F — Админка: «Предзаказы» + настройки (frontend-admin)

1. Раздел «Предзаказы» (`pages/Preorders.tsx`, роут `/preorders`, пункт в `CONFIG`-навигации):
   - список активных по точке (селектор точки), статус, ETA/остаток, сумма, состав;
   - кнопки «Принять», «Готовится», «Готов», «Оплачено», «Отклонить» (с причиной);
   - автообновление 10 с, тост на ошибку, `ConfirmDialog` на отклонение.
2. Настройки на точке: `prepMinutes` (3…30), `noShowBanHours` (1…168), `autoReady` — форма в том же разделе.
3. Бан-лист: список активных банов + «Снять».

**GREEN:** `admin vitest`, `tsc`, `vite build`; ручной прогон: принять → готов → оплачено → состав и статусы меняются.

---

### STAGE G — Приёмка E2E (full-stack/QA)

1. Прогнать сценарий: PWA создаёт заказ → админка «Принять» → баннер «Готовится ~N» →
   авто-«Готов» по ETA → «Оплачено» → «Я забрал» → active null.
2. Негатив: второй заказ (409), TTL-истечение (бан 403), чужая точка (403), cancel.
3. Регресс: loyalty resolve/redeem, `/configuration`, каталог, очередь, скидки — без изменений.
4. `docs/PREORDER-UX-ACCEPTANCE.md`: PASS/FAIL/BLOCKED + вердикт.

**GREEN:** отчёт с вердиктом, полный набор тестов зелёный.

---

## 4. P1 / P2 (после MVP)

| Приоритет | Задача | Зачем |
|---|---|---|
| P1-1 | Гостевые схемы товара `GET /api/preorder/config/:productId?storeId=` (переиспользовать `buildProductConfiguration`) + выбор объёма/молока/корицы/добавок в `ProductSheet` | «заказ как в прототипе» без раздувания directory |
| P1-2 | Push/PWA-уведомление «заказ готов» | гость не держит экран открытым |
| P1-3 | Ручной ETA кассиром на кассе (в APK) | точность в час-пик |
| P2-1 | Store picker (карта/список, часы, open/close) | нужны данные `stores.hours/coords` |
| P2-2 | Бонусы (подарок/ваучер/кэшбэк) в корзине с серверным quote | прототип, но требует отдельного API |
| P2-3 | Меню 1:1 с дизайном | большая отдельная задача |
| P2-4 | Приложение бариста (отдельное) | будущее, вне этого репозитория |

## 5. Риски и как их снимаем

| Риск | Снятие |
|---|---|
| APK не двигает статусы → баннер «мёртвый» | Stage C даёт админ-страховку; APK — отдельный промпт |
| Часы телефона врут → неверный остаток | `serverNow` в ответе, отсчёт от дельты |
| Кэш/офлайн показывает старый статус | последний известный + пометка «нет сети», TTL не продлеваем |
| Бан по ошибке (гость не виноват) | ручное снятие в админке + `reason` и `order_id` в записи |
| Пустой `eta_ready_at` у старых заказов | фолбэк: `accepted_at + prepMinutes`, иначе «уточняем» |
| Дубли заказов при двойном тапе | single-flight на клиенте + проверка active на сервере |

# FOLLOW-UP REPORT — замечания ревью F-01…F-05

Ветка: `main`. Push **не выполнялся** (см. F-04). Deploy не выполнялся.

| Параметр | Значение |
|---|---|
| HEAD до follow-up | `d50e6f4` (docs: implementation report for admin gap fixes) |
| HEAD после follow-up | `e748501` |
| Коммиты follow-up | `a7a1439`, `378caa1`, `7476745`, `e748501` |
| Backend тесты | 248 passed / 45 файлов |
| Admin тесты | 23 passed / 5 файлов |
| PWA тесты | 52 passed / 4 файла |
| typecheck | 3/3 OK |
| build | 3/3 OK |

Проверки запускались теми же командами, что CI (`.github/workflows/ci.yml`), локально, включая backend с изолированной БД `DB_PATH=/tmp/ci-backend.db`.

---

## Сводка по замечаниям

| ID | Статус | Коммит | Тесты | Заметки |
|---|---|---|---|---|
| F-01 UI: деактивация ≠ «удалили навсегда» | DONE | `378caa1`, `e748501` | `entityStatus.test.ts` (3), backend `suppliers-crud` / `stock-items-inventory` | Бейдж «выключен/выключена», подсказка с родом, показ выключенных позиций склада |
| F-02 Help / подписи Банк: два шага | DONE | `7476745` | — (текст) | Статья `logic-link` в Help + строка-hint в `BankTab` |
| F-03 R-02: защита от регресса enabled-фильтра | DONE | `a7a1439` | `product-store-enabled-push.test.ts` (6) | Фильтр + `pruneDisabledOutbox` |
| F-04 CI на GitHub | DONE (локально), push не выполнялся | `ca503cb` (ранее) | 8 шагов workflow прогнаны локально | Чеклист ниже |
| F-05 Polish API deactivate | DONE | `378caa1` | те же backend-наборы | `reasonCode` + `linked` |

---

## F-01 + F-05 — деактивация вместо удаления

### Backend

`backend/src/modules/admin/stock.ts`

- `DELETE /suppliers/:id` и `DELETE /stock/items/:id`: если есть связанные документы — запись не удаляется физически, а деактивируется.
- Ответ унифицирован:

```json
{
  "ok": true,
  "deactivated": true,
  "reasonCode": "has_linked_documents",
  "reason": "…человекочитаемо…",
  "linked": { "purchase_invoices": 1, "purchase_orders": 1, "stock_batches": 1 }
}
```

- Удаление несуществующей записи → `404`.
- `stock_items.default_supplier_id` при деактивации поставщика обнуляется.

Тесты: `backend/src/__tests__/suppliers-crud.test.ts`, `backend/src/__tests__/stock-items-inventory.test.ts` — проверяют `deactivated`, `reasonCode`, состав `linked`.

### Admin

`frontend-admin/src/lib/format.ts`

- `entityStatusLabel(active, gender = 'm')` → `{ label: 'активен' | 'выключен' | 'выключена', tone }`.
- `deactivatedHint(gender = 'm')` → «Не удалён / Не удалена: есть связанные документы, история сохранена».

`frontend-admin/src/pages/Purchases.tsx` (вкладка «Поставщики»)

- Бейдж статуса через `entityStatusLabel`.
- Подсказка `deactivatedHint()` у выключенного поставщика.
- `ConfirmDialog` предупреждает, что запись может быть выключена, а не удалена.
- Тип ответа расширен `reasonCode`; если API вернул `reason`, он показывается пользователю.

`frontend-admin/src/pages/Stock.tsx` (вкладка «Номенклатура»)

- Новый запрос `useApi('/stock/items')` → `allItems`: вкладка показывает и выключенные позиции с бейджем «выключена», пониженной непрозрачностью и подсказкой `deactivatedHint('f')`.
- `reloadAll` обновляет и `allItems`.

Тесты: `frontend-admin/src/lib/entityStatus.test.ts` — 3 кейса, включая проверку женского рода и отсутствия формулировки «удалён».

### Живая проверка (preview, `http://admin.localhost:3970`, `NODE_ENV=production`)

- `DELETE /suppliers/:id` для поставщика с документами → `reasonCode: has_linked_documents`, `linked: { purchase_invoices: 1, purchase_orders: 1, stock_batches: 1 }`.
- `DELETE /stock/items/:id` → `linked: { stock_movements, stock_batches, purchase_invoice_lines, purchase_order_lines }`.
- Вкладка «Поставщики»: `F01-поставщик — Не удалён: есть связанные документы, история сохранена · выключен · Изменить · Удалить`.
- Вкладка «Склад → Номенклатура»: `F01-сырьё · выключена · Не удалена: есть связанные документы, история сохранена · норма · Изменить · Удалить`.

---

## F-02 — два шага в банке

`frontend-admin/src/pages/Help.tsx`, статья `logic-link` переписана: шаг 1 — сопоставить строку выписки с накладной (долг не меняется); шаг 2 — «Провести оплату» (создаёт платёж, уменьшает долг в «Долгах» и учитывается в «Сверках»).

`frontend-admin/src/pages/purchases/BankTab.tsx` — короткая подсказка над формой импорта с тем же смыслом; текст проверен на превью.

Формулировки не переписывают Help целиком, дизайн не менялся.

---

## F-03 — семантика `enabled` при выгрузке в Эвотор

`backend/src/integrations/evotor/sync/ProductPushService.ts`

- `productEnabledForStore(productId, storeUuid)`: нет строки в `product_store_links` → `enabled = 1` (совместимость со старыми товарами), `enabled = 0` → выгрузка запрещена.
- `pruneDisabledOutbox(storeUuid)` — публичный метод: перед выборкой PENDING задач снимает задачи по товарам, у которых галочка снята (перевод в `DONE` с `last_error = 'skipped: product disabled for this store'`), чтобы ранее поставленная задача не «догнала» товар.
- `enabled=0` — не выгружаем новое, **allow_to_sell=false не отправляем** (по default из ТЗ).

`backend/src/__tests__/product-store-enabled-push.test.ts` — 6 кейсов:

1. товар без link → задача ставится на sync-точку (compat);
2. link `enabled=1` → задача есть;
3. link `enabled=0` → новой задачи нет;
4. `productEnabledForStore` — три состояния (нет строки / 1 / 0);
5. снятие галочки → `pruneDisabledOutbox` убирает стоящую PENDING-задачу;
6. повторный вызов `pruneDisabledOutbox` идемпотентен.

---

## F-04 — CI

`.github/workflows/ci.yml` валиден под root-скрипты; шаги: `npm ci` → typecheck → build → три `vitest`.

Локальная симуляция всех шагов workflow пройдена.

### Push и фактический статус Actions

- [x] `git push origin main` — выполнен: `7e67a23..c781f33` (18 коммитов)
- [ ] Actions run зелёный: **не достигнут по внешней причине**

Run №1 ([40279153760](https://github.com/demossml/sixth-cup/actions/runs/40279153760), HEAD `c781f33`) завершился `failure` за 3 секунды, при этом **ни один шаг workflow не запускался**. Аннотация GitHub:

> The job was not started because your account is locked due to a billing issue.

То есть это блокировка аккаунта владельца репозитория на стороне GitHub (Actions-минуты для приватного репозитория), а не падение typecheck/build/тестов. Код и конфигурация CI в порядке: все 8 шагов workflow прогнаны локально в тех же версиях инструментов и зелёные.

Что нужно, чтобы получить зелёный run: восстановить биллинг GitHub Actions у владельца аккаунта и перезапустить workflow (`Re-run all jobs`) либо дождаться следующего push. Код менять не требуется.

---

## Что сознательно не делалось

- Web Push, `EVOTOR_PROXY_ENFORCE`, `/devices/sales` — вне scope постановки.
- Orphan-аналитика (39 backend-эндпоинтов без клиента) — не подключалась.
- Репозиторий `demossml/evotor-app` — не затрагивался.
- Hard-delete поставщиков и позиций склада с историей — не вводился (default: деактивация).
- Автоматическое создание платежа при привязке `bank_row` к накладной — не вводилось (default: только явная «Провести оплату»).
- Миграции БД, модели данных, дизайн-система — без изменений.

## Осталось на ручную проверку

- Поведение при `enabled=0` на реальном облаке Эвотор (нужен токен и устройство) — статус `UNVERIFIED`.

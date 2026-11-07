# ПРОМПТ АГЕНТУ НА MINI: выкладка `sixth-cup` и настройка push (VAPID)

Ты — агент на машине **Mini** (production). Доступа к моей машине у тебя нет: код приходит **только**
через GitHub (`demossml/sixth-cup`, ветка `main`).
Задача: забрать изменения, собрать, применить миграции, **сгенерировать VAPID-ключи**, включить
push-уведомления «заказ готов», перезапустить сервис и подтвердить работу. Ничего лишнего не менять.

---

## 0. Жёсткие правила

1. **Не перезаписывать** `.env` целиком: только добавить/обновить указанные ключи.
2. **Не трогать** базу вручную: только миграции через приложение.
3. **Не удалять** `data/`, `uploads/`, `.env`, ключи (`data/keys.json`).
4. Перед выкладкой — **бэкап БД** (см. 2.1). Без бэкапа дальше не идти.
5. Секреты (`VAPID_PRIVATE_KEY`, `ADMIN_TOKEN`, `JWT_SECRET`) не выводить в чат, в логи и в отчёт.
   В отчёт — только «установлено/не установлено» и публичный ключ.
6. Если что-то не сходится с этим промптом — **остановиться** и описать расхождение, а не «догадываться».
7. Пуш не должен ломать текущую работу: если что-то не так — выключить фичу флагом (см. 5.3),
   сервис оставить живым, написать в отчёт.

---

## 1. Что должно быть в `main`

Проверь, что в `main` есть:

| Файл / изменение | Зачем |
|---|---|
| `backend/src/db/migrations/044_menu_showcase.sql` | КБЖУ, «Популярное», бейджи, часы и координаты точек |
| `backend/src/modules/catalog/guestMenuConfig.ts`, `GET /api/directory/config/:id` | карточка товара в PWA |
| `backend/src/db/migrations/046_push.sql` + `POST/DELETE /api/push/subscribe` | подписки на push |
| `frontend/src/` — экраны меню/карточки/корзины/кофеен | новый PWA |
| `frontend-admin/src/` — поля КБЖУ/бейдж/популярное, «Кофейни в приложении», `menu_hero` | админка |

Если чего-то нет — **остановиться**, написать чего именно не хватает и какой коммит нужен.

---

## 2. Выкладка

### 2.1. Бэкап

```bash
cd /opt/sixth-cup            # фактический путь возьми из systemd-юнита, см. 2.4
TS=$(date +%Y%m%d-%H%M%S)
cp backend/data/sixth-cup.db  backend/data/backup-$TS.db
# если включён WAL — предпочтительнее online-backup:
sqlite3 backend/data/sixth-cup.db ".backup backend/data/backup-$TS.db"
ls -la backend/data/backup-$TS.db     # путь и размер записать в отчёт
```

### 2.2. Код и зависимости

```bash
git fetch origin
git status --porcelain         # должно быть пусто; если есть локальные правки — СТОП, опиши их
git pull --ff-only origin main
git log --oneline -3           # SHA записать в отчёт
npm ci
```

### 2.3. Сборка и миграции

```bash
npm run typecheck
npm run build                  # backend + frontend + frontend-admin
npm run test -w frontend && npm run test -w frontend-admin
cd backend && DB_PATH=$(mktemp -u /tmp/t-XXXX.db) npx vitest run && cd ..
```

Миграции применяются автоматически при старте API (`runMigrations`). Отдельно руками SQL **не** выполнять.

### 2.4. Перезапуск сервиса

```bash
systemctl cat sixth-cup-api | head -20        # уточнить имя юнита и WorkingDirectory
sudo systemctl restart sixth-cup-api         # или pm2 restart <name>, если проект на pm2
sleep 3
curl -sS http://127.0.0.1:3000/api/directory | head -c 300
journalctl -u sixth-cup-api -n 50 --no-pager | grep -i "migrate\|error" 
```

Ожидаемо в логе: `[migrate] applied 044_menu_showcase`, `[migrate] applied 046_push` (если ещё не применялись).

---

## 3. VAPID-ключи (для push)

Генерируются **на Mini**, приватный ключ остаётся только там.

```bash
npx web-push generate-vapid-keys --json
```

Вывод:
```json
{ "publicKey": "B…", "privateKey": "…" }
```

### 3.1. Прописать в `.env` (не в git!)

```dotenv
# push-уведомления «заказ готов»
VAPID_PUBLIC_KEY=<publicKey>
VAPID_PRIVATE_KEY=<privateKey>
VAPID_SUBJECT=mailto:owner@67coffee.ru
```

`VAPID_SUBJECT` — контакт для push-сервисов, поставь реальный email владельца.

### 3.2. Проверить, что бэкенд их видит

```bash
curl -sS http://127.0.0.1:3000/api/push/public-key
→ 200 { "ok": true, "publicKey": "B…" }
→ 503 { "ok": false, "error": "push_disabled" }     # ключей нет — см. 5.3
```

---

## 4. Проверка push end-to-end

1. Открой PWA на телефоне (HTTPS-домен), войди картой, открой активный заказ → «Включить уведомления» →
   разреши уведомления. В БД должна появиться запись:
   ```bash
   sqlite3 backend/data/sixth-cup.db "select id,user_id,substr(endpoint,1,40),created_at from push_subscriptions order by id desc limit 3"
   ```
2. Создай тестовый заказ из PWA и переведи его в `ready` из админки («Предзаказы» → «Готов»).
3. Ожидаемо: в течение ~10 с на телефон приходит «Заказ NNNN готов — забирайте», тап открывает заказ.
4. Если не пришло — смотри `journalctl -u sixth-cup-api | grep -i push`, код ответа push-сервиса
   (`404/410` = подписка умерла → удалить, `401/403` = ключи не совпадают).

---

## 5. Регламент и откат

### 5.1. Health-check после выкладки

```bash
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/            # 200 (PWA)
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/api/directory
curl -sS http://127.0.0.1:3000/api/directory | python3 -c "import json,sys; d=json.load(sys.stdin); print('products', len(d['products']), 'stores', len(d['stores']))"
```

### 5.2. Откат

```bash
git log --oneline -5                 # найти предыдущий рабочий SHA
git checkout <prev-sha> && npm ci && npm run build
sudo systemctl restart sixth-cup-api
# если нужно откатить БД:
cp backend/data/backup-<TS>.db backend/data/sixth-cup.db && sudo systemctl restart sixth-cup-api
```

Миграции аддитивные — откат кода без открута схемы безопасен.

### 5.3. Выключить push, если что-то пошло не так

Единственный выключатель — **VAPID-ключи в `.env`**. Флага `PUSH_ENABLED` в коде нет (старая
документация вводила в заблуждение): PWA гейтит push по `GET /api/push/public-key`.

```bash
# в .env — закомментировать оба ключа
# VAPID_PUBLIC_KEY=…
# VAPID_PRIVATE_KEY=…
sudo systemctl restart sixth-cup-api
curl -sS http://127.0.0.1:3000/api/push/public-key     # 503 push_disabled
```
API и заказы продолжают работать, push не отправляется, кнопка «Включить уведомления» не показывается.
Обратное включение — раскомментировать ключи и перезапустить сервис (подписки в
`push_subscriptions` не теряются).

---

## 6. Отчёт агента Mini

Файл `DEPLOY-<дата>.md` в `/opt/sixth-cup/docs/` (в git не коммитить, если не просят):

1. `git log --oneline -1` — SHA выкладки.
2. Бэкап: путь, размер.
3. Что применилось: список `[migrate] applied …` из журнала.
4. `npm run typecheck` / `build` / тесты — PASS/FAIL (сколько тестов).
5. VAPID: «public key установлен, приватный — в `.env`», без значений.
6. `GET /api/push/public-key` → код ответа.
7. Push e2e: пришло/не пришло, время доставки.
8. Health-check: коды ответов и счётчики `products/stores`.
9. Что **не** трогал (перечислить явно): `.env` (кроме добавленных ключей), база, `uploads/`, ключи.
10. Проблемы и что сделал.

---

## 7. Чего делать нельзя

- Класть `.env` или приватный ключ в git, в чат, в отчёт.
- Менять цены, товары, лояльность в БД руками.
- Пересоздавать базу «начисто» ради миграций.
- Обновлять Node/npm/системные пакеты без запроса.
- Открывать порты наружу, менять nginx/домены (если только это не требуется для HTTPS push — тогда
  сначала спроси владельца, приложив текущий конфиг).

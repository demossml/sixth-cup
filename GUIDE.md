# «Шестой стакан» — офлайн-приложение лояльности для кофейни (PWA)

> Стек: **Turborepo** · **backend** = Hono + TypeScript + SQLite · **frontend** = React + Vite + TypeScript + PWA.
> Пакетов два: `backend` и `frontend`.
> Это полная замена предыдущих гайдов. Старые можно удалить.

---

## 0. Что изменилось и какие допущения я сделал

### Главная проблема
У людей **нет стабильного интернета**. Поэтому приложение — **offline-first лояльность**, а не «магазин с онлайн-оплатой».

### Две обязательные механики

1. **Каждый 6-й стакан бесплатно**  
   5 оплаченных → 6-й в подарок. Считается накопительно за всё время. Работает полностью офлайн.

2. **Реферальный кэшбэк 3 %**  
   Друг регистрируется по QR/ссылке пригласившего.  
   **Всегда** (навсегда) пригласивший получает **3 % от суммы каждой оплаченной покупки** этого друга.  
   Кэшбэк копится на балансе пригласившего и может быть применён как скидка на кассе (офлайн).

### Что осталось / что убрано

| Оставлено | Убрано / сильно упрощено |
|---|---|
| Карта клиента + накопление стаканов | Полноценный предзаказ с корзиной и статусами |
| Купоны / скидки (приветственный, акции) | Онлайн-оплата, эквайринг, онлайн-кассы |
| Приглашение друзей по QR/ссылке | Сложные статусы заказов |
| Рекламные баннеры и акции | |
| Режим кассы (то же PWA) | |
| Синхронизация, когда появился Wi-Fi | |

Оплата всегда на кассе (наличные, терминал, СБП). Приложение платежей не принимает.

### Допущения (скажи, если что-то не так)

1. У кофейни есть устройство кассира (телефон/планшет) с тем же PWA в режиме `/cashier`. Оно тоже работает офлайн.
2. Клиент и касса обмениваются данными **только через QR-коды**. Интернет для обмена не нужен.
3. Валюта — рубли, суммы **целые** (без копеек). Кэшбэк округляется вниз: `Math.floor(amount * 0.03)`.
4. Название «Шестой стакан» и имя пакета `sixth-cup` — рабочие. Можно заменить.
5. Один человек может пригласить сколько угодно друзей. Один человек может быть приглашён только один раз (при регистрации).
6. Кэшбэк начисляется **только с оплаченных** покупок друга (поле `a` в чеке). Бесплатные стаканы и уже применённые скидки в базу кэшбэка не входят.

---

## 1. Концепция: как это работает без интернета

### 1.1 Главная идея

> **Карта клиента — это документ, подписанный цифровой подписью.**  
> Телефон хранит его сам. Кассир проверяет подпись **без интернета**, потому что открытый ключ уже лежит в приложении.

Как печать на бумажном купоне: подделать нельзя, проверить можно на месте.

### 1.2 Три участника

| Участник | Что делает | Работает офлайн? |
|---|---|---|
| **Клиент** (PWA на телефоне) | Показывает QR карты, принимает «чеки», видит прогресс и баланс кэшбэка | Да |
| **Касса** (то же PWA, `/cashier`) | Сканирует карту, начисляет стаканы, выдаёт бесплатный, применяет купон/кэшбэк, подписывает чек | Да |
| **Сервер** (Hono) | Хранит истину, выдаёт подписанные карты, принимает чеки, начисляет кэшбэк рефералам, рассылает акции | Только для синхронизации |

### 1.3 Ключевые понятия

- **Карта-доказательство (card proof)** — строка `данные.подпись`.  
  В данных: `u` (клиент), `q` (версия), `p` (оплаченные стаканы), `f` (выданные бесплатные), `v` (купоны), `cb` (баланс кэшбэка в ₽), `i` (время).  
  Подписывает **сервер**.

- **Чек (receipt)** — такая же строка, но подписывает **касса**.  
  Содержит новое состояние + изменения (`dp`, `df`, `vu`, `dcb`, `a`).

- **Версия `q`** — растёт с каждым изменением. Из двух документов свежее тот, у кого `q` больше.

- **Справочник (directory)** — открытые ключи сервера и касс, меню (для справки), акции. Скачивается при наличии сети и кэшируется.

- **Кэшбэк-баланс `cb`** — целые рубли. Начисляется сервером при применении чеков друзей. Тратится на кассе (офлайн), если кассир подтверждает.

### 1.4 Правило «каждый 6-й бесплатно»

Карта хранит:
- `p` — всего оплаченных стаканов за всё время
- `f` — сколько бесплатных уже выдано

```
заработано бесплатных = floor(p / 5)
доступно бесплатных   = floor(p / 5) − f
прогресс до подарка   = p mod 5   (из 5)
```

Пример: `p = 5, f = 0` → доступен 1 бесплатный. Выдали → `f = 1`. Дальше копим следующие 5.  
Формула не ломается, если человек купил сразу 7 стаканов.

### 1.5 Реферальный кэшбэк 3 %

1. У каждого пользователя есть уникальный `invite_code` (генерируется при регистрации).
2. Клиент видит свой QR/ссылку приглашения (`/?invite=ABCD1234`).
3. Друг открывает ссылку → код сохраняется в `localStorage` → при регистрации пишется `invited_by`.
4. Когда друг совершает покупку и чек доходит до сервера:
   - Сервер берёт сумму чека `a`.
   - Начисляет пригласившему `Math.floor(a * 0.03)` на баланс `cashback_balance`.
5. При следующей синхронизации пригласивший получает обновлённую карту с новым `cb`.
6. На кассе кассир может списать часть или весь `cb` как скидку (поле `dcb` в чеке).

**Почему 3 % именно от суммы чека, а не от «стаканов»:**  
Сумма уже известна кассиру и попадает в подписанный чек. Стаканы — абстракция, а деньги — конкретная величина. Округление вниз защищает от дробных копеек.

**Гипотеза риска:** друг и пригласивший могут сговориться и «крутить» мелкие покупки.  
**Защита:** кэшбэк начисляется только после того, как чек принят сервером от известной (не отозванной) кассы. Касса физически принимает оплату. Злоупотребление стоит реальных денег в кассе кофейни, а не «виртуальных стаканов».

### 1.6 Что происходит в кофейне (без интернета)

```
Клиент                              Касса
  │  показывает QR своей карты        │
  │ ───────────────────────────────▶  │ 1. сканирует, проверяет подпись (офлайн)
  │                                   │ 2. видит: стаканов 4/5, купон −10%, кэшбэк 47 ₽
  │                                   │ 3. вводит: куплено 1 стакан, сумма 190 ₽,
  │                                   │    купон и/или списание кэшбэка
  │                                   │ 4. создаёт ЧЕК: p=5, q+1, dcb=…, подписывает
  │  сканирует QR чека                │
  │ ◀───────────────────────────────  │ 5. показывает QR чека
  │ 6. проверяет подпись, сохраняет   │
  │    → на карте 5/5, 🎁 доступен    │
```

### 1.7 Что происходит потом (когда появился Wi-Fi)

1. Приложение клиента вызывает `POST /api/sync`: отправляет накопленные чеки.
2. Сервер проверяет подписи касс, **прибавляет** изменения к своей карте.
3. Если у клиента есть `invited_by` и в чеке `a > 0` — начисляет 3 % пригласившему.
4. Сервер возвращает новую подписанную карту (с актуальным `cb` и купонами).
5. Касса делает то же самое через `POST /api/devices/sync`. Один и тот же чек могут прислать оба — сервер запоминает `id` чека и не считает дважды.

**Важный принцип:** карта на сервере = сумма всех чеков. Порядок прихода не важен.

### 1.8 Что работает без интернета, а что нет

| Работает офлайн | Нужен интернет |
|---|---|
| Открыть приложение, показать карту | Первый вход (SMS-код), один раз |
| Накопить стакан, получить бесплатный | Получить **новые** купоны и свежий кэшбэк |
| Применить купон / списать кэшбэк, которые уже в карте | Пригласить друга (ссылка работает, начисление — на сервере) |
| Смотреть акции из кэша | Обновить акции, список касс |
| Касса: полный цикл продажи | Отправка чеков на сервер |

### 1.9 Безопасность: что защищено и где честные ограничения

**Защищено:**
- Клиент не может сам нарисовать себе стаканы или кэшбэк: без ключа сервера/кассы подпись не сойдётся.
- Сервер принимает только чеки от известных, не отозванных касс.
- Чеки нельзя засчитать дважды (уникальный `id`).
- Потерянную кассу можно отозвать (`revoked`).

**Ограничения offline-режима:**
- **Повторное использование старой карты.** Клиент может сохранить карту «до получения бесплатного» и показать в другой кассе.  
  Что делаем: каждая касса помнит последнюю версию `q` клиента и отклоняет более старую; сервер при синхронизации находит двойной бесплатный / двойной купон / двойной кэшбэк и пишет в `disputes`. Цена риска — один стакан или небольшая сумма, а не деньги из кассы.
- **Часы устройств.** Не полагаемся на точность времени, только на подпись и `q`.
- **Ключ кассы лежит в браузере.** Если планшет украли — отзови его в админке.

---

## 2. Установка

- **Node.js 20+** (лучше 22): https://nodejs.org. Проверка: `node -v`.
- Терминал и VS Code.
- Для `better-sqlite3` обычно скачивается готовая сборка. Если падает — инструменты сборки:
  - Windows: Visual Studio Build Tools + «Desktop development with C++»
  - macOS: `xcode-select --install`
  - Linux: `sudo apt install build-essential python3`

---

## 3. Структура папок

```
sixth-cup/
├─ package.json
├─ turbo.json
├─ tsconfig.base.json
├─ .gitignore
├─ backend/
│  ├─ package.json
│  ├─ tsconfig.json
│  └─ src/
│     ├─ index.ts
│     ├─ app.ts
│     ├─ config.ts
│     ├─ db/ (schema.ts, index.ts, seed.ts)
│     ├─ lib/ (errors.ts, crypto.ts)
│     ├─ middleware/ (auth.ts, device.ts)
│     └─ modules/
│        ├─ auth/ (service.ts, routes.ts)
│        ├─ vouchers/service.ts
│        ├─ loyalty/ (rules.ts, proof.ts, receipts.ts)   ← ЯДРО
│        ├─ directory/routes.ts
│        ├─ sync/routes.ts
│        ├─ devices/routes.ts
│        └─ admin/routes.ts
└─ frontend/
   ├─ package.json
   ├─ tsconfig.json
   ├─ vite.config.ts
   ├─ index.html
   ├─ public/icon.svg
   ├─ scripts/make-icons.mjs
   └─ src/
      ├─ main.tsx
      ├─ vite-env.d.ts
      ├─ App.tsx
      ├─ styles.css
      ├─ api.ts
      ├─ lib/ (types.ts, crypto.ts, db.ts, proof.ts, directory.ts, customer.ts, cashier.ts, app.tsx)
      ├─ components/ (Qr.tsx, ScanModal.tsx)
      └─ pages/ (LoginPage, CardPage, PromosPage, ProfilePage, CashierPage)
```

Убраны модули заказов — приложение стало чище и ближе к «только лояльность + скидки».

---

## 4. Шаг 1. Корень монорепозитория

```bash
mkdir sixth-cup && cd sixth-cup
mkdir backend frontend
```

### `package.json`
```json
{
  "name": "sixth-cup",
  "private": true,
  "packageManager": "npm@10.8.2",
  "workspaces": ["backend", "frontend"],
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "typecheck": "turbo run typecheck"
  },
  "devDependencies": {
    "turbo": "^2.3.0",
    "typescript": "^5.6.0"
  }
}
```

### `turbo.json`
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "dev": { "cache": false, "persistent": true },
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "typecheck": { "dependsOn": ["^typecheck"] }
  }
}
```

### `tsconfig.base.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true
  }
}
```

### `.gitignore`
```
node_modules
dist
.turbo
backend/data
.env
```

> ⚠️ `backend/data/keys.json` — **секретный ключ подписи сервера**. Не должен попасть в git и должен бэкапиться. Потеряешь ключ — все выданные карты станут недействительными.

---

## 5. Шаг 2. Backend

### 5.1 `backend/package.json`
```json
{
  "name": "@sixth-cup/backend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": { "types": "./src/app.ts", "default": "./src/app.ts" }
  },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsup src/index.ts --format esm --clean",
    "start": "NODE_ENV=production node dist/index.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@hono/node-server": "^1.13.0",
    "@hono/zod-validator": "^0.4.0",
    "@noble/curves": "^1.6.0",
    "better-sqlite3": "^11.5.0",
    "hono": "^4.6.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.0.0",
    "tsup": "^8.3.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  }
}
```

`@noble/curves` — маленькая проверенная библиотека Ed25519. Работает и в Node, и в браузере (включая старые телефоны).

### 5.2 `backend/tsconfig.json`
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src"]
}
```

### 5.3 `backend/src/config.ts`
```ts
const isDev = process.env.NODE_ENV !== 'production'

export const config = {
  port: Number(process.env.PORT ?? 3000),
  isDev,
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  adminToken: process.env.ADMIN_TOKEN ?? 'dev-admin',
  dbPath: process.env.DB_PATH ?? './data/sixth-cup.db',
  keysPath: process.env.KEYS_PATH ?? './data/keys.json',

  // Правило: 5 оплаченных → 6-й бесплатно.
  // НЕ МЕНЯЙ после запуска: изменится расчёт у всех существующих карт.
  cupsForFree: 5,

  // Реферальный кэшбэк: 3 % от суммы чека друга.
  // НЕ МЕНЯЙ после запуска без миграции балансов.
  referralCashbackPercent: 3,

  currency: 'RUB',
  maxVouchersInCard: 5,
}

if (!isDev && (config.jwtSecret === 'dev-secret-change-me' || config.adminToken === 'dev-admin')) {
  throw new Error('Set JWT_SECRET and ADMIN_TOKEN in production!')
}
```

### 5.4 `backend/src/db/schema.ts`
```ts
export const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  invited_by INTEGER REFERENCES users(id),
  cashback_balance INTEGER NOT NULL DEFAULT 0,  -- накопленный кэшбэк в ₽
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sms_codes (
  phone TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Карта клиента: истина на сервере = сумма всех чеков
CREATE TABLE IF NOT EXISTS cards (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  paid_total INTEGER NOT NULL DEFAULT 0,  -- p
  free_used INTEGER NOT NULL DEFAULT 0,   -- f
  seq INTEGER NOT NULL DEFAULT 0,         -- q
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS voucher_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- percent | fixed
  value INTEGER NOT NULL,
  valid_days INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vouchers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  template_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  value INTEGER NOT NULL,
  expires_day INTEGER NOT NULL,
  used_at INTEGER,
  receipt_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_vouchers_user ON vouchers(user_id);

CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id),
  name TEXT NOT NULL,
  public_key TEXT,
  token_hash TEXT,
  enroll_code TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Все принятые чеки. PRIMARY KEY по id = защита от двойного зачёта.
CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  device_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  dp INTEGER NOT NULL,
  df INTEGER NOT NULL,
  dcb INTEGER NOT NULL DEFAULT 0,     -- списанный кэшбэк
  amount INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  raw TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);

-- Журнал начислений кэшбэка (для прозрачности и споров)
CREATE TABLE IF NOT EXISTS cashback_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  beneficiary_id INTEGER NOT NULL REFERENCES users(id),  -- кому начислили
  from_user_id INTEGER NOT NULL REFERENCES users(id),    -- от чьей покупки
  receipt_id TEXT NOT NULL,
  amount INTEGER NOT NULL,                               -- сколько ₽
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cashback_ben ON cashback_ledger(beneficiary_id);

CREATE TABLE IF NOT EXISTS disputes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  user_id INTEGER,
  receipt_id TEXT,
  details TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  emoji TEXT NOT NULL DEFAULT '☕',
  available INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS promos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '🎉',
  sponsor TEXT,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL
);
`
```

### 5.5 `backend/src/db/index.ts`
```ts
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { config } from '../config'
import { SCHEMA } from './schema'

mkdirSync(dirname(config.dbPath), { recursive: true })

export const db = new Database(config.dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.exec(SCHEMA)
```

### 5.6 `backend/src/lib/errors.ts`
```ts
import { HTTPException } from 'hono/http-exception'

export const bad = (message: string, status: 400 | 401 | 403 | 404 | 409 = 400) =>
  new HTTPException(status, { message })
```

### 5.7 `backend/src/lib/crypto.ts`
```ts
import { ed25519 } from '@noble/curves/ed25519'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { config } from '../config'

export const b64u = {
  enc: (b: Uint8Array) => Buffer.from(b).toString('base64url'),
  dec: (s: string) => new Uint8Array(Buffer.from(s, 'base64url')),
}

function loadPrivateKey(): Uint8Array {
  if (existsSync(config.keysPath)) {
    const k = JSON.parse(readFileSync(config.keysPath, 'utf8')) as { priv: string }
    return b64u.dec(k.priv)
  }
  const priv = ed25519.utils.randomPrivateKey()
  mkdirSync(dirname(config.keysPath), { recursive: true })
  writeFileSync(config.keysPath, JSON.stringify({ priv: b64u.enc(priv) }), { mode: 0o600 })
  return priv
}

const privateKey = loadPrivateKey()

export const serverPub = b64u.enc(ed25519.getPublicKey(privateKey))

export function signToken(payload: object): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  return `${b64u.enc(bytes)}.${b64u.enc(ed25519.sign(bytes, privateKey))}`
}

export function verifyWith(token: string, pubKeyB64: string): unknown | null {
  const [p, s] = token.split('.')
  if (!p || !s) return null
  try {
    const bytes = b64u.dec(p)
    if (!ed25519.verify(b64u.dec(s), bytes, b64u.dec(pubKeyB64))) return null
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

export function peek(token: string): { t?: string; d?: number } | null {
  try {
    return JSON.parse(Buffer.from(token.split('.')[0] ?? '', 'base64url').toString('utf8'))
  } catch {
    return null
  }
}
```

### 5.8 `backend/src/middleware/auth.ts`
```ts
import { createMiddleware } from 'hono/factory'
import { verify } from 'hono/jwt'
import { config } from '../config'
import { bad } from '../lib/errors'

export type AuthEnv = { Variables: { userId: number } }

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const header = c.req.header('Authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined
  if (!token) throw bad('Unauthorized', 401)
  try {
    const payload = await verify(token, config.jwtSecret, 'HS256')
    c.set('userId', Number(payload.sub))
  } catch {
    throw bad('Invalid token', 401)
  }
  await next()
})
```

### 5.9 `backend/src/middleware/device.ts`
```ts
import { createHash } from 'node:crypto'
import { createMiddleware } from 'hono/factory'
import { db } from '../db'
import { bad } from '../lib/errors'

export type DeviceEnv = { Variables: { deviceId: number; storeId: number } }

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex')

export const requireDevice = createMiddleware<DeviceEnv>(async (c, next) => {
  const token = c.req.header('X-Device-Token')
  if (!token) throw bad('Unauthorized', 401)
  const d = db.prepare('SELECT id, store_id, revoked FROM devices WHERE token_hash=?')
    .get(hashToken(token)) as { id: number; store_id: number; revoked: number } | undefined
  if (!d || d.revoked) throw bad('Invalid device', 401)
  c.set('deviceId', d.id)
  c.set('storeId', d.store_id)
  await next()
})
```

### 5.10 Купоны — `backend/src/modules/vouchers/service.ts`
```ts
import { db } from '../../db'
import { config } from '../../config'

/** [id, 'p'|'f', значение, срок_в_днях] */
export type VoucherTuple = [number, 'p' | 'f', number, number]

export const todayDay = () => Math.floor(Date.now() / 86_400_000)

export function grantVoucher(userId: number, code: string) {
  const t = db.prepare('SELECT * FROM voucher_templates WHERE code=?').get(code) as
    | { id: number; title: string; kind: string; value: number; valid_days: number }
    | undefined
  if (!t) throw new Error(`Unknown voucher template ${code}`)
  db.prepare(`INSERT INTO vouchers(user_id,template_id,title,kind,value,expires_day)
              VALUES(?,?,?,?,?,?)`).run(userId, t.id, t.title, t.kind, t.value, todayDay() + t.valid_days)
}

export function activeVouchers(userId: number): VoucherTuple[] {
  const rows = db.prepare(`
    SELECT id, kind, value, expires_day FROM vouchers
    WHERE user_id=? AND used_at IS NULL AND expires_day>=?
    ORDER BY expires_day LIMIT ?`)
    .all(userId, todayDay(), config.maxVouchersInCard) as
    { id: number; kind: string; value: number; expires_day: number }[]
  return rows.map((r): VoucherTuple => [r.id, r.kind === 'percent' ? 'p' : 'f', r.value, r.expires_day])
}
```

### 5.11 Ядро лояльности

**`backend/src/modules/loyalty/rules.ts`**
```ts
import { config } from '../../config'

export const freeEarned = (paidTotal: number) => Math.floor(paidTotal / config.cupsForFree)

export const cashbackOf = (amount: number) => Math.floor((amount * config.referralCashbackPercent) / 100)
```

**`backend/src/modules/loyalty/proof.ts`**
```ts
import { db } from '../../db'
import { signToken } from '../../lib/crypto'
import { activeVouchers } from '../vouchers/service'

export function ensureCard(userId: number) {
  db.prepare('INSERT OR IGNORE INTO cards(user_id, updated_at) VALUES(?,?)').run(userId, Date.now())
}

/** Подписанная карта. Именно её показывает QR на телефоне. */
export function buildCardProof(userId: number): string {
  ensureCard(userId)
  const c = db.prepare('SELECT paid_total, free_used, seq FROM cards WHERE user_id=?')
    .get(userId) as { paid_total: number; free_used: number; seq: number }
  const u = db.prepare('SELECT cashback_balance FROM users WHERE id=?')
    .get(userId) as { cashback_balance: number }
  return signToken({
    t: 'c',
    u: userId,
    q: c.seq,
    p: c.paid_total,
    f: c.free_used,
    v: activeVouchers(userId),
    cb: u.cashback_balance,   // баланс кэшбэка в ₽
    i: Math.floor(Date.now() / 1000),
  })
}
```

**`backend/src/modules/loyalty/receipts.ts`**
```ts
import { z } from 'zod'
import { db } from '../../db'
import { peek, verifyWith } from '../../lib/crypto'
import { grantVoucher } from '../vouchers/service'
import { ensureCard } from './proof'
import { cashbackOf, freeEarned } from './rules'

const receiptSchema = z.object({
  t: z.literal('r'),
  r: z.string().min(3).max(60),
  u: z.number().int().positive(),
  d: z.number().int().positive(),
  q: z.number().int().min(0),
  p: z.number().int().min(0),
  f: z.number().int().min(0),
  v: z.array(z.tuple([z.number(), z.enum(['p', 'f']), z.number(), z.number()])).max(10),
  cb: z.number().int().min(0),          // баланс кэшбэка ПОСЛЕ списания (для офлайн-проверки)
  dp: z.number().int().min(0).max(50),
  df: z.number().int().min(0).max(3),
  dcb: z.number().int().min(0).max(50_000), // сколько кэшбэка списали
  vu: z.array(z.number().int()).max(3),
  a: z.number().int().min(0).max(1_000_000),
  ts: z.number().int(),
})
type Receipt = z.infer<typeof receiptSchema>

export type ApplyResult = {
  applied: string[]
  duplicates: string[]
  rejected: { reason: string }[]
}

function dispute(kind: string, userId: number, receiptId: string, details: string) {
  db.prepare('INSERT INTO disputes(kind,user_id,receipt_id,details,created_at) VALUES(?,?,?,?,?)')
    .run(kind, userId, receiptId, details, Date.now())
}

function applyOne(r: Receipt) {
  ensureCard(r.u)

  // 1. Обновляем карту (складываем изменения)
  db.prepare(`UPDATE cards SET paid_total = paid_total + ?, free_used = free_used + ?,
              seq = MAX(seq, ?) + 1, updated_at = ? WHERE user_id = ?`)
    .run(r.dp, r.df, r.q, Date.now(), r.u)

  // 2. Списываем кэшбэк
  if (r.dcb > 0) {
    const u = db.prepare('SELECT cashback_balance FROM users WHERE id=?')
      .get(r.u) as { cashback_balance: number }
    if (u.cashback_balance < r.dcb) {
      dispute('cashback_overdraw', r.u, r.r, `tried ${r.dcb}, had ${u.cashback_balance}`)
    } else {
      db.prepare('UPDATE users SET cashback_balance = cashback_balance - ? WHERE id=?')
        .run(r.dcb, r.u)
    }
  }

  // 3. Купоны
  for (const id of r.vu) {
    const v = db.prepare('SELECT user_id, used_at FROM vouchers WHERE id=?')
      .get(id) as { user_id: number; used_at: number | null } | undefined
    if (!v || v.user_id !== r.u) dispute('voucher_invalid', r.u, r.r, `voucher ${id}`)
    else if (v.used_at) dispute('voucher_double_use', r.u, r.r, `voucher ${id} already used`)
    else db.prepare('UPDATE vouchers SET used_at=?, receipt_id=? WHERE id=?').run(Date.now(), r.r, id)
  }

  // 4. Проверка бесплатных
  const after = db.prepare('SELECT paid_total, free_used FROM cards WHERE user_id=?')
    .get(r.u) as { paid_total: number; free_used: number }
  if (after.free_used > freeEarned(after.paid_total))
    dispute('free_cup_overdraw', r.u, r.r, `free_used=${after.free_used}, earned=${freeEarned(after.paid_total)}`)

  // 5. Реферальный кэшбэк 3 % пригласившему
  if (r.a > 0) {
    const u = db.prepare('SELECT invited_by FROM users WHERE id=?').get(r.u) as { invited_by: number | null }
    if (u.invited_by) {
      const bonus = cashbackOf(r.a)
      if (bonus > 0) {
        db.prepare('UPDATE users SET cashback_balance = cashback_balance + ? WHERE id=?')
          .run(bonus, u.invited_by)
        db.prepare(`INSERT INTO cashback_ledger(beneficiary_id,from_user_id,receipt_id,amount,created_at)
                    VALUES(?,?,?,?,?)`)
          .run(u.invited_by, r.u, r.r, bonus, Date.now())
      }
    }
  }

  // 6. Приветственный бонус за первую покупку приглашённого (опционально, можно убрать)
  // Оставляем только кэшбэк, без разового купона — по ТЗ «всегда 3 %».
}

export const applyReceipts = db.transaction((tokens: string[]): ApplyResult => {
  const result: ApplyResult = { applied: [], duplicates: [], rejected: [] }
  const now = Math.floor(Date.now() / 1000)

  for (const token of tokens.slice(0, 200)) {
    const head = peek(token)
    if (head?.t !== 'r' || typeof head.d !== 'number') { result.rejected.push({ reason: 'bad format' }); continue }

    const dev = db.prepare('SELECT public_key, revoked FROM devices WHERE id=?')
      .get(head.d) as { public_key: string | null; revoked: number } | undefined
    if (!dev?.public_key || dev.revoked) { result.rejected.push({ reason: 'unknown or revoked device' }); continue }

    const parsed = receiptSchema.safeParse(verifyWith(token, dev.public_key))
    if (!parsed.success) { result.rejected.push({ reason: 'bad signature' }); continue }
    const r = parsed.data

    if (!r.r.startsWith(`${r.d}-`) || r.ts > now + 86_400) { result.rejected.push({ reason: 'bad receipt' }); continue }
    if (!db.prepare('SELECT 1 FROM users WHERE id=?').get(r.u)) { result.rejected.push({ reason: 'unknown user' }); continue }

    const ins = db.prepare(`INSERT OR IGNORE INTO receipts(id,device_id,user_id,dp,df,dcb,amount,ts,raw,applied_at)
                            VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(r.r, r.d, r.u, r.dp, r.df, r.dcb, r.a, r.ts, token, Date.now())
    if (ins.changes === 0) { result.duplicates.push(r.r); continue }

    applyOne(r)
    result.applied.push(r.r)
  }
  return result
})
```

### 5.12 Авторизация

**`backend/src/modules/auth/service.ts`**
```ts
import { randomBytes } from 'node:crypto'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { ensureCard } from '../loyalty/proof'
import { grantVoucher } from '../vouchers/service'

export function sendCode(phone: string) {
  const code = String(Math.floor(1000 + Math.random() * 9000))
  db.prepare('INSERT OR REPLACE INTO sms_codes(phone, code, expires_at) VALUES(?,?,?)')
    .run(phone, code, Date.now() + 5 * 60_000)
  // Продакшен: SMS.ru / SMSC / Devino
  return code
}

const registerUser = db.transaction((phone: string, inviteCode?: string) => {
  const inviter = inviteCode
    ? (db.prepare('SELECT id FROM users WHERE invite_code=?').get(inviteCode.toUpperCase()) as { id: number } | undefined)
    : undefined
  const r = db.prepare('INSERT INTO users(phone,nickname,invite_code,invited_by,created_at) VALUES(?,?,?,?,?)')
    .run(phone, `Гость ${phone.slice(-4)}`, randomBytes(4).toString('hex').toUpperCase(), inviter?.id ?? null, Date.now())
  const userId = Number(r.lastInsertRowid)
  ensureCard(userId)
  grantVoucher(userId, 'WELCOME')
  return userId
})

export function verifyCodeAndLogin(input: { phone: string; code: string; inviteCode?: string }): number {
  const row = db.prepare('SELECT code, expires_at FROM sms_codes WHERE phone=?')
    .get(input.phone) as { code: string; expires_at: number } | undefined
  if (!row || row.code !== input.code || row.expires_at < Date.now()) throw bad('Неверный или просроченный код')
  db.prepare('DELETE FROM sms_codes WHERE phone=?').run(input.phone)

  const existing = db.prepare('SELECT id FROM users WHERE phone=?').get(input.phone) as { id: number } | undefined
  return existing?.id ?? registerUser(input.phone, input.inviteCode)
}
```

**`backend/src/modules/auth/routes.ts`**
```ts
import { Hono } from 'hono'
import { sign } from 'hono/jwt'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { config } from '../../config'
import { sendCode, verifyCodeAndLogin } from './service'

const phone = z.string().regex(/^\+?\d{10,15}$/, 'Телефон: 10–15 цифр')

export const authRoutes = new Hono()
  .post('/send-code', zValidator('json', z.object({ phone })), (c) => {
    const code = sendCode(c.req.valid('json').phone)
    return c.json({ ok: true, devCode: config.isDev ? code : undefined })
  })
  .post('/verify',
    zValidator('json', z.object({ phone, code: z.string().length(4), inviteCode: z.string().optional() })),
    async (c) => {
      const userId = verifyCodeAndLogin(c.req.valid('json'))
      const token = await sign({ sub: userId, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 180 }, config.jwtSecret)
      return c.json({ token })
    })
```

### 5.13 Справочник — `backend/src/modules/directory/routes.ts`
```ts
import { Hono } from 'hono'
import { config } from '../../config'
import { db } from '../../db'
import { serverPub } from '../../lib/crypto'

export const directoryRoutes = new Hono().get('/', (c) => {
  const now = Math.floor(Date.now() / 1000)
  const devices = db.prepare('SELECT id, public_key AS pub, revoked FROM devices WHERE public_key IS NOT NULL')
    .all() as { id: number; pub: string; revoked: number }[]
  const stores = db.prepare('SELECT id, name, address FROM stores').all() as { id: number; name: string; address: string }[]
  const products = db.prepare('SELECT id, name, price, emoji FROM products WHERE available=1')
    .all() as { id: number; name: string; price: number; emoji: string }[]
  const promos = db.prepare(`SELECT id, title, body, emoji, sponsor, ends_at AS endsAt FROM promos
                             WHERE starts_at<=? AND ends_at>=? ORDER BY id DESC`)
    .all(now, now) as { id: number; title: string; body: string; emoji: string; sponsor: string | null; endsAt: number }[]

  return c.json({
    serverPub,
    cupsForFree: config.cupsForFree,
    referralCashbackPercent: config.referralCashbackPercent,
    currency: config.currency,
    generatedAt: now,
    devices: devices.map((d) => ({ id: d.id, pub: d.pub, revoked: !!d.revoked })),
    stores, products, promos,
  })
})
```

### 5.14 Синхронизация клиента — `backend/src/modules/sync/routes.ts`
```ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../../db'
import { requireAuth, type AuthEnv } from '../../middleware/auth'
import { buildCardProof } from '../loyalty/proof'
import { applyReceipts } from '../loyalty/receipts'

export const syncRoutes = new Hono<AuthEnv>()
  .use('*', requireAuth)
  .post('/', zValidator('json', z.object({ receipts: z.array(z.string().max(3000)).max(200) })), (c) => {
    const userId = c.get('userId')
    const result = applyReceipts(c.req.valid('json').receipts)
    const u = db.prepare('SELECT id, nickname, invite_code, cashback_balance FROM users WHERE id=?')
      .get(userId) as { id: number; nickname: string; invite_code: string; cashback_balance: number }
    return c.json({
      card: buildCardProof(userId),
      me: { id: u.id, nickname: u.nickname, inviteCode: u.invite_code, cashbackBalance: u.cashback_balance },
      result,
    })
  })
```

### 5.15 Касса — `backend/src/modules/devices/routes.ts`
```ts
import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { hashToken, requireDevice, type DeviceEnv } from '../../middleware/device'
import { applyReceipts } from '../loyalty/receipts'

export const deviceRoutes = new Hono<DeviceEnv>()
  .post('/enroll',
    zValidator('json', z.object({ code: z.string().min(4).max(20), publicKey: z.string().length(43) })),
    (c) => {
      const { code, publicKey } = c.req.valid('json')
      const d = db.prepare('SELECT id, store_id FROM devices WHERE enroll_code=? AND revoked=0')
        .get(code.toUpperCase()) as { id: number; store_id: number } | undefined
      if (!d) throw bad('Код регистрации не найден', 404)
      const token = randomBytes(24).toString('base64url')
      db.prepare('UPDATE devices SET public_key=?, token_hash=?, enroll_code=NULL WHERE id=?')
        .run(publicKey, hashToken(token), d.id)
      const store = db.prepare('SELECT name FROM stores WHERE id=?').get(d.store_id) as { name: string }
      return c.json({ deviceId: d.id, deviceToken: token, storeName: store.name })
    })

  .use('/sync', requireDevice)
  .post('/sync', zValidator('json', z.object({ receipts: z.array(z.string().max(3000)).max(200) })), (c) => {
    const result = applyReceipts(c.req.valid('json').receipts)
    return c.json({ result })
  })
```

### 5.16 Админка — `backend/src/modules/admin/routes.ts`
```ts
import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { config } from '../../config'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { grantVoucher } from '../vouchers/service'

export const adminRoutes = new Hono()
  .use('*', createMiddleware(async (c, next) => {
    if (c.req.header('X-Admin-Token') !== config.adminToken) throw bad('Forbidden', 403)
    await next()
  }))

  .post('/devices', zValidator('json', z.object({ storeId: z.number().int(), name: z.string().min(1).max(60) })), (c) => {
    const { storeId, name } = c.req.valid('json')
    const code = randomBytes(4).toString('hex').toUpperCase()
    const r = db.prepare('INSERT INTO devices(store_id,name,enroll_code,created_at) VALUES(?,?,?,?)')
      .run(storeId, name, code, Date.now())
    return c.json({ id: Number(r.lastInsertRowid), enrollCode: code })
  })

  .post('/devices/:id/revoke', (c) => {
    db.prepare('UPDATE devices SET revoked=1 WHERE id=?').run(Number(c.req.param('id')))
    return c.json({ ok: true })
  })

  .post('/promos', zValidator('json', z.object({
    title: z.string().min(1).max(80), body: z.string().max(300), emoji: z.string().max(4).default('🎉'),
    sponsor: z.string().max(80).optional(), days: z.number().int().min(1).max(365),
  })), (c) => {
    const p = c.req.valid('json')
    const now = Math.floor(Date.now() / 1000)
    db.prepare('INSERT INTO promos(title,body,emoji,sponsor,starts_at,ends_at) VALUES(?,?,?,?,?,?)')
      .run(p.title, p.body, p.emoji, p.sponsor ?? null, now, now + p.days * 86_400)
    return c.json({ ok: true })
  })

  .delete('/promos/:id', (c) => {
    db.prepare('DELETE FROM promos WHERE id=?').run(Number(c.req.param('id')))
    return c.json({ ok: true })
  })

  .post('/products', zValidator('json', z.object({
    id: z.number().int().optional(), name: z.string().min(1).max(60), price: z.number().int().min(0),
    emoji: z.string().max(4).default('☕'), available: z.boolean().default(true),
  })), (c) => {
    const p = c.req.valid('json')
    if (p.id) db.prepare('UPDATE products SET name=?,price=?,emoji=?,available=? WHERE id=?')
      .run(p.name, p.price, p.emoji, p.available ? 1 : 0, p.id)
    else db.prepare('INSERT INTO products(name,price,emoji,available) VALUES(?,?,?,?)')
      .run(p.name, p.price, p.emoji, p.available ? 1 : 0)
    return c.json({ ok: true })
  })

  .post('/vouchers/grant-all', zValidator('json', z.object({ code: z.string() })), (c) => {
    const ids = db.prepare('SELECT id FROM users').all() as { id: number }[]
    db.transaction(() => { for (const u of ids) grantVoucher(u.id, c.req.valid('json').code) })()
    return c.json({ granted: ids.length })
  })

  .get('/disputes', (c) => c.json({
    disputes: db.prepare('SELECT * FROM disputes ORDER BY id DESC LIMIT 100').all(),
  }))

  .get('/cashback/:userId', (c) => {
    const id = Number(c.req.param('userId'))
    const rows = db.prepare(`SELECT * FROM cashback_ledger WHERE beneficiary_id=? ORDER BY id DESC LIMIT 50`)
      .all(id)
    const u = db.prepare('SELECT cashback_balance FROM users WHERE id=?').get(id) as { cashback_balance: number } | undefined
    return c.json({ balance: u?.cashback_balance ?? 0, ledger: rows })
  })
```

### 5.17 Стартовые данные — `backend/src/db/seed.ts`
```ts
import { config } from '../config'
import { db } from './index'

export function seedIfEmpty() {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM stores').get() as { n: number }
  if (n > 0) return

  db.transaction(() => {
    db.prepare('INSERT INTO stores(name,address) VALUES(?,?)').run('Кофейня на Ленина', 'ул. Ленина, 1')
    db.prepare('INSERT INTO stores(name,address) VALUES(?,?)').run('Кофейня у вокзала', 'Привокзальная пл., 3')

    const pr = db.prepare('INSERT INTO products(name,price,emoji) VALUES(?,?,?)')
    pr.run('Американо', 150, '☕'); pr.run('Капучино', 190, '🥛'); pr.run('Латте', 210, '🥛')
    pr.run('Флэт уайт', 220, '☕'); pr.run('Чай с лимоном', 120, '🍋'); pr.run('Круассан', 130, '🥐')

    const vt = db.prepare('INSERT INTO voucher_templates(code,title,kind,value,valid_days) VALUES(?,?,?,?,?)')
    vt.run('WELCOME', 'Скидка 10% на первую покупку', 'percent', 10, 30)
    vt.run('WEEK15', 'Скидка 15% на этой неделе', 'percent', 15, 7)

    const now = Math.floor(Date.now() / 1000)
    const pm = db.prepare('INSERT INTO promos(title,body,emoji,sponsor,starts_at,ends_at) VALUES(?,?,?,?,?,?)')
    pm.run('Каждый 6-й стакан бесплатно', 'Копите стаканы — подарок получите автоматически.', '🎁', null, now, now + 365 * 86_400)
    pm.run('Приведи друга — получай 3%', 'За каждую покупку друга тебе 3% кэшбэком.', '🤝', null, now, now + 365 * 86_400)
    pm.run('Круассан к кофе −20%', 'Предложение партнёра — пекарни «Хлебный дом».', '🥐', 'Пекарня «Хлебный дом»', now, now + 30 * 86_400)

    if (config.isDev) {
      db.prepare('INSERT INTO devices(store_id,name,enroll_code,created_at) VALUES(?,?,?,?)')
        .run(1, 'Demo tablet', 'DEMO1234', Date.now())
    }
  })()
}
```

### 5.18 `backend/src/app.ts`
```ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { HTTPException } from 'hono/http-exception'
import { serveStatic } from '@hono/node-server/serve-static'
import { config } from './config'
import { adminRoutes } from './modules/admin/routes'
import { authRoutes } from './modules/auth/routes'
import { deviceRoutes } from './modules/devices/routes'
import { directoryRoutes } from './modules/directory/routes'
import { syncRoutes } from './modules/sync/routes'

const app = new Hono()
app.use('*', logger())
app.use('/api/*', cors())

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

app.get('/health', (c) => c.json({ ok: true }))

const routes = app
  .route('/api/auth', authRoutes)
  .route('/api/directory', directoryRoutes)
  .route('/api/sync', syncRoutes)
  .route('/api/devices', deviceRoutes)
  .route('/api/admin', adminRoutes)

export type AppType = typeof routes
export { app }
export default app

if (!config.isDev) {
  app.use('/*', serveStatic({ root: '../frontend/dist' }))
  app.get('*', serveStatic({ path: '../frontend/dist/index.html' }))
}
```

### 5.19 `backend/src/index.ts`
```ts
import { serve } from '@hono/node-server'
import { app } from './app'
import { config } from './config'
import { seedIfEmpty } from './db/seed'

seedIfEmpty()

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`☕ Шестой стакан API: http://localhost:${info.port}`)
})
```

---

## 6. Шаг 3. Frontend (PWA)

### 6.1 `frontend/package.json`
```json
{
  "name": "@sixth-cup/frontend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "icons": "node scripts/make-icons.mjs",
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@noble/curves": "^1.6.0",
    "hono": "^4.6.0",
    "idb": "^8.0.0",
    "jsqr": "^1.4.0",
    "qrcode": "^1.5.4",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.27.0"
  },
  "devDependencies": {
    "@sixth-cup/backend": "*",
    "@types/node": "^22.0.0",
    "@types/qrcode": "^1.5.5",
    "@types/react": "^18.3.11",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.3",
    "sharp": "^0.33.5",
    "typescript": "^5.6.0",
    "vite": "^5.4.10",
    "vite-plugin-pwa": "^0.21.0"
  }
}
```

### 6.2 `frontend/tsconfig.json`
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["src", "vite.config.ts"]
}
```

### 6.3 `frontend/vite.config.ts`
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: true },
      manifest: {
        name: 'Шестой стакан',
        short_name: '6-й стакан',
        lang: 'ru',
        display: 'standalone',
        start_url: '/',
        background_color: '#fff8f0',
        theme_color: '#7a4a21',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
})
```

### 6.4 Иконка

**`frontend/public/icon.svg`**
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="110" fill="#7a4a21"/>
  <text x="256" y="330" font-size="270" text-anchor="middle" fill="#fff8f0" font-family="sans-serif" font-weight="800">6</text>
  <path d="M120 400h272" stroke="#f2b46d" stroke-width="18" stroke-linecap="round"/>
</svg>
```

**`frontend/scripts/make-icons.mjs`**
```js
import sharp from 'sharp'
for (const size of [192, 512]) {
  await sharp('public/icon.svg').resize(size, size).png().toFile(`public/icon-${size}.png`)
}
console.log('icons ready')
```

### 6.5 `frontend/index.html`
```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#7a4a21" />
    <link rel="icon" href="/icon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/icon-192.png" />
    <title>Шестой стакан</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### 6.6 `frontend/src/vite-env.d.ts`
```ts
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
```

### 6.7 `frontend/src/main.tsx`
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { AppProvider } from './lib/app'
import './styles.css'

registerSW({ immediate: true })

const invite = new URLSearchParams(location.search).get('invite')
if (invite) localStorage.setItem('sc-invite', invite)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
```

### 6.8 `frontend/src/lib/types.ts`
```ts
export type Voucher = [id: number, kind: 'p' | 'f', value: number, expDay: number]

export type CardState = {
  u: number; q: number; p: number; f: number; v: Voucher[]; cb: number
}
export type CardProof = CardState & { t: 'c'; i: number }
export type ReceiptPayload = CardState & {
  t: 'r'; r: string; d: number
  dp: number; df: number; dcb: number; vu: number[]; a: number; ts: number
}

export type Directory = {
  serverPub: string
  cupsForFree: number
  referralCashbackPercent: number
  currency: string
  generatedAt: number
  devices: { id: number; pub: string; revoked: boolean }[]
  stores: { id: number; name: string; address: string }[]
  products: { id: number; name: string; price: number; emoji: string }[]
  promos: { id: number; title: string; body: string; emoji: string; sponsor: string | null; endsAt: number }[]
}

export type Me = { id: number; nickname: string; inviteCode: string; cashbackBalance: number }
export type StoredReceipt = { id: string; token: string; uploaded: 0 | 1; userId: number; q: number }
```

### 6.9 `frontend/src/lib/crypto.ts`
```ts
import { ed25519 } from '@noble/curves/ed25519'

export const b64u = {
  enc(bytes: Uint8Array): string {
    let s = ''
    bytes.forEach((b) => (s += String.fromCharCode(b)))
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  },
  dec(str: string): Uint8Array {
    const s = str.replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4))
    return Uint8Array.from(bin, (c) => c.charCodeAt(0))
  },
}
const te = new TextEncoder()
const td = new TextDecoder()

export function peek<T>(token: string): T | null {
  try { return JSON.parse(td.decode(b64u.dec(token.split('.')[0] ?? ''))) as T } catch { return null }
}

export function openToken<T>(token: string, pubKeyB64: string): T | null {
  const [p, s] = token.split('.')
  if (!p || !s) return null
  try {
    const bytes = b64u.dec(p)
    if (!ed25519.verify(b64u.dec(s), bytes, b64u.dec(pubKeyB64))) return null
    return JSON.parse(td.decode(bytes)) as T
  } catch { return null }
}

export function signPayload(payload: object, privateKey: Uint8Array): string {
  const bytes = te.encode(JSON.stringify(payload))
  return `${b64u.enc(bytes)}.${b64u.enc(ed25519.sign(bytes, privateKey))}`
}

export function newKeypair() {
  const priv = ed25519.utils.randomPrivateKey()
  return { priv, pub: ed25519.getPublicKey(priv) }
}
```

### 6.10 `frontend/src/lib/db.ts`
```ts
import { openDB } from 'idb'
import type { StoredReceipt } from './types'

const dbp = openDB('sixth-cup', 1, {
  upgrade(db) {
    db.createObjectStore('kv')
    db.createObjectStore('receipts', { keyPath: 'id' })
    db.createObjectStore('seen', { keyPath: 'userId' })
  },
})

export const kvGet = async <T>(key: string) => (await (await dbp).get('kv', key)) as T | undefined
export const kvSet = async (key: string, value: unknown) => { await (await dbp).put('kv', value, key) }
export const kvDel = async (key: string) => { await (await dbp).delete('kv', key) }

export const putReceipt = async (r: StoredReceipt) => { await (await dbp).put('receipts', r) }
export const allReceipts = async () => (await (await dbp).getAll('receipts')) as StoredReceipt[]

export type Seen = { userId: number; q: number; token: string }
export const putSeen = async (s: Seen) => { await (await dbp).put('seen', s) }
export const getSeen = async (userId: number) => (await (await dbp).get('seen', userId)) as Seen | undefined

export async function clearUserData() {
  const d = await dbp
  await d.delete('kv', 'card'); await d.delete('kv', 'me')
  await d.clear('receipts')
}
```

### 6.11 `frontend/src/api.ts`
```ts
import { hc } from 'hono/client'
import type { AppType } from '@sixth-cup/backend'

export const getJwt = () => localStorage.getItem('sc-jwt')
export const setJwt = (t: string | null) => (t ? localStorage.setItem('sc-jwt', t) : localStorage.removeItem('sc-jwt'))

const timedFetch: typeof fetch = (input, init) => {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 8000)
  return fetch(input, { ...init, signal: ctl.signal }).finally(() => clearTimeout(timer))
}

export const api = hc<AppType>('/', {
  fetch: timedFetch,
  headers: (): Record<string, string> => {
    const t = getJwt()
    return t ? { Authorization: `Bearer ${t}` } : {}
  },
})

export const deviceApi = (token: string) =>
  hc<AppType>('/', { fetch: timedFetch, headers: { 'X-Device-Token': token } })

export async function unwrap<T>(p: Promise<{ ok: boolean; json: () => Promise<T> }>): Promise<T> {
  const res = await p
  if (!res.ok) {
    const body = (await res.json()) as unknown as { error?: string }
    throw new Error(body.error ?? 'Ошибка запроса')
  }
  return res.json()
}
```

### 6.12 `frontend/src/lib/proof.ts`
```ts
import { openToken, peek } from './crypto'
import type { CardProof, CardState, Directory, ReceiptPayload } from './types'

export const todayDay = () => Math.floor(Date.now() / 86_400_000)

export const freeAvailable = (s: CardState, n: number) => Math.floor(s.p / n) - s.f
export const progress = (s: CardState, n: number) => s.p % n
export const activeVouchers = (s: CardState) => s.v.filter((v) => v[3] >= todayDay())

export type Verified = { kind: 'card' | 'receipt'; payload: CardProof | ReceiptPayload; at: number }

export function verifyProof(token: string, dir: Directory): Verified | null {
  const head = peek<{ t?: string; d?: number }>(token)
  if (!head) return null

  if (head.t === 'c') {
    const p = openToken<CardProof>(token, dir.serverPub)
    return p ? { kind: 'card', payload: p, at: p.i } : null
  }
  if (head.t === 'r') {
    const dev = dir.devices.find((d) => d.id === head.d && !d.revoked)
    if (!dev) return null
    const p = openToken<ReceiptPayload>(token, dev.pub)
    return p ? { kind: 'receipt', payload: p, at: p.ts } : null
  }
  return null
}

export function newest(list: Verified[]): Verified | null {
  return list.sort((a, b) => b.payload.q - a.payload.q || b.at - a.at)[0] ?? null
}

export function discountFor(v: CardState['v'][number] | undefined, amount: number) {
  if (!v) return 0
  return v[1] === 'p' ? Math.floor((amount * v[2]) / 100) : Math.min(v[2], amount)
}
```

### 6.13 `frontend/src/lib/directory.ts`
```ts
import { api, unwrap } from '../api'
import { kvGet, kvSet } from './db'
import type { Directory } from './types'

export const loadDirectory = () => kvGet<Directory>('directory')

export async function refreshDirectory(): Promise<Directory | null> {
  try {
    const d = (await unwrap(api.api.directory.$get())) as unknown as Directory
    await kvSet('directory', d)
    return d
  } catch {
    return null
  }
}
```

### 6.14 `frontend/src/lib/customer.ts`
```ts
import { api, unwrap } from '../api'
import { allReceipts, kvGet, kvSet, putReceipt } from './db'
import { refreshDirectory } from './directory'
import { newest, verifyProof, type Verified } from './proof'
import type { CardState, Directory, Me } from './types'

export type Best = { state: CardState; token: string }

export async function computeBest(dir: Directory, me: Me): Promise<Best | null> {
  const tokens: string[] = []
  const card = await kvGet<string>('card')
  if (card) tokens.push(card)
  for (const r of await allReceipts()) tokens.push(r.token)

  const ok: (Verified & { token: string })[] = []
  for (const t of tokens) {
    const v = verifyProof(t, dir)
    if (v && v.payload.u === me.id) ok.push({ ...v, token: t })
  }
  const best = newest(ok) as (Verified & { token: string }) | null
  return best ? { state: best.payload, token: best.token } : null
}

export async function addReceipt(token: string, dir: Directory | null, me: Me | null) {
  if (!dir || !me) return { ok: false as const, reason: 'Нужно один раз подключиться к интернету.' }
  const v = verifyProof(token, dir)
  if (!v || v.kind !== 'receipt')
    return { ok: false as const, reason: 'Это не чек кассы (или касса новая — обновите по Wi-Fi).' }
  if (v.payload.u !== me.id) return { ok: false as const, reason: 'Этот чек относится к другой карте.' }
  await putReceipt({ id: (v.payload as { r: string }).r, token, uploaded: 0, userId: me.id, q: v.payload.q })
  return { ok: true as const }
}

export type SyncStatus = 'ok' | 'offline' | 'auth'

export async function syncCustomer(): Promise<SyncStatus> {
  const dir = await refreshDirectory()
  if (!dir) return 'offline'

  const pending = (await allReceipts()).filter((r) => !r.uploaded)
  try {
    const res = await unwrap(api.api.sync.$post({ json: { receipts: pending.map((r) => r.token) } }))
    await kvSet('card', res.card)
    await kvSet('me', res.me)
    const done = new Set([...res.result.applied, ...res.result.duplicates])
    for (const r of pending) if (done.has(r.id)) await putReceipt({ ...r, uploaded: 1 })
    localStorage.setItem('sc-last-sync', String(Date.now()))
    return 'ok'
  } catch (e) {
    const m = (e as Error).message
    return m === 'Unauthorized' || m === 'Invalid token' ? 'auth' : 'offline'
  }
}
```

### 6.15 `frontend/src/lib/cashier.ts`
```ts
import { deviceApi, unwrap } from '../api'
import { api } from '../api'
import { b64u, newKeypair, signPayload } from './crypto'
import { allReceipts, kvGet, kvSet, putReceipt, putSeen } from './db'
import { refreshDirectory } from './directory'
import type { CardState, ReceiptPayload } from './types'

export type DeviceCreds = { deviceId: number; token: string; priv: string; storeName: string }

export const loadCreds = () => kvGet<DeviceCreds>('device')

export async function enroll(code: string): Promise<DeviceCreds> {
  const { priv, pub } = newKeypair()
  const res = await unwrap(api.api.devices.enroll.$post({ json: { code, publicKey: b64u.enc(pub) } }))
  const creds: DeviceCreds = { deviceId: res.deviceId, token: res.deviceToken, priv: b64u.enc(priv), storeName: res.storeName }
  await kvSet('device', creds)
  return creds
}

function newReceiptId(deviceId: number) {
  const rnd = crypto.getRandomValues(new Uint8Array(3))
  return `${deviceId}-${Date.now().toString(36)}-${b64u.enc(rnd)}`
}

export async function createReceipt(
  creds: DeviceCreds, base: CardState,
  o: { cups: number; useFree: boolean; voucherId: number | null; cashbackUse: number; amount: number },
) {
  const vu = o.voucherId ? [o.voucherId] : []
  const dcb = Math.min(o.cashbackUse, base.cb)
  const payload: ReceiptPayload = {
    t: 'r', r: newReceiptId(creds.deviceId), u: base.u, d: creds.deviceId,
    q: base.q + 1,
    p: base.p + o.cups,
    f: base.f + (o.useFree ? 1 : 0),
    v: base.v.filter((x) => !vu.includes(x[0])),
    cb: base.cb - dcb,
    dp: o.cups, df: o.useFree ? 1 : 0, dcb, vu, a: o.amount,
    ts: Math.floor(Date.now() / 1000),
  }
  const token = signPayload(payload, b64u.dec(creds.priv))
  await putReceipt({ id: payload.r, token, uploaded: 0, userId: base.u, q: payload.q })
  await putSeen({ userId: base.u, q: payload.q, token })
  return { token, payload }
}

export async function syncCashier(creds: DeviceCreds): Promise<'ok' | 'offline'> {
  if (!(await refreshDirectory())) return 'offline'
  const pending = (await allReceipts()).filter((r) => !r.uploaded)
  try {
    const res = await unwrap(deviceApi(creds.token).api.devices.sync.$post({ json: { receipts: pending.map((r) => r.token) } }))
    const done = new Set([...res.result.applied, ...res.result.duplicates])
    for (const r of pending) if (done.has(r.id)) await putReceipt({ ...r, uploaded: 1 })
    return 'ok'
  } catch { return 'offline' }
}
```

### 6.16 `frontend/src/lib/app.tsx`
```tsx
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { getJwt } from '../api'
import { computeBest, syncCustomer, type Best } from './customer'
import { kvGet } from './db'
import { loadDirectory, refreshDirectory } from './directory'
import type { Directory, Me } from './types'

type Ctx = {
  dir: Directory | null
  me: Me | null
  best: Best | null
  syncing: boolean
  lastSync: number
  sync: () => Promise<string>
  reload: () => Promise<void>
}
const AppCtx = createContext<Ctx>(null!)
export const useApp = () => useContext(AppCtx)

export function AppProvider({ children }: { children: ReactNode }) {
  const [dir, setDir] = useState<Directory | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [best, setBest] = useState<Best | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState(Number(localStorage.getItem('sc-last-sync') ?? 0))

  const reload = useCallback(async () => {
    const d = (await loadDirectory()) ?? null
    const m = (await kvGet<Me>('me')) ?? null
    setDir(d); setMe(m)
    setBest(d && m ? await computeBest(d, m) : null)
    setLastSync(Number(localStorage.getItem('sc-last-sync') ?? 0))
  }, [])

  const sync = useCallback(async () => {
    if (!getJwt()) { await refreshDirectory(); await reload(); return 'noauth' }
    setSyncing(true)
    const r = await syncCustomer()
    setSyncing(false)
    await reload()
    return r
  }, [reload])

  useEffect(() => {
    reload().then(() => sync())
    const run = () => { void sync() }
    const onVisible = () => { if (!document.hidden) run() }
    window.addEventListener('online', run)
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(run, 60_000)
    return () => {
      window.removeEventListener('online', run)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
    }
  }, [reload, sync])

  return <AppCtx.Provider value={{ dir, me, best, syncing, lastSync, sync, reload }}>{children}</AppCtx.Provider>
}
```

### 6.17 Компоненты

**`frontend/src/components/Qr.tsx`**
```tsx
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

export default function Qr({ value }: { value: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    QRCode.toDataURL(value, { errorCorrectionLevel: 'L', margin: 2, width: 360 }).then(setSrc)
  }, [value])
  return src ? <img src={src} alt="QR-код" className="qr" /> : null
}
```

**`frontend/src/components/ScanModal.tsx`**
```tsx
import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'

export default function ScanModal({ title, onResult, onClose }: {
  title: string; onResult: (text: string) => void; onClose: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')
  const [manual, setManual] = useState('')

  useEffect(() => {
    let stopped = false
    let stream: MediaStream | undefined
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!

    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        stream = s
        const v = video.current!
        v.srcObject = s
        v.setAttribute('playsinline', 'true')
        void v.play()
        const tick = () => {
          if (stopped) return
          if (v.readyState === v.HAVE_ENOUGH_DATA) {
            canvas.width = v.videoWidth; canvas.height = v.videoHeight
            ctx.drawImage(v, 0, 0)
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
            if (code?.data) { onResult(code.data); return }
          }
          requestAnimationFrame(tick)
        }
        tick()
      })
      .catch(() => setError('Нет доступа к камере. Разрешите камеру или вставьте код вручную.'))

    return () => { stopped = true; stream?.getTracks().forEach((t) => t.stop()) }
  }, [])

  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h1>{title}</h1>
        <video ref={video} className="video" muted />
        {error && <p className="error">{error}</p>}
        <details>
          <summary className="muted">Ввести код вручную</summary>
          <textarea value={manual} onChange={(e) => setManual(e.target.value)} rows={3} />
          <button className="btn small" onClick={() => manual.trim() && onResult(manual.trim())}>Применить</button>
        </details>
        <button className="btn ghost" style={{ marginTop: 8 }} onClick={onClose}>Закрыть</button>
      </div>
    </div>
  )
}
```

### 6.18 `frontend/src/styles.css`
```css
:root { --brand:#7a4a21; --brand-soft:#f6ead9; --text:#2a1c10; --muted:#8c7b6b; --line:#eadfd2; --bg:#fff8f0; --ok:#1c8a4b; --bad:#c2371f; }
* { box-sizing: border-box; }
body { margin:0; font-family: system-ui, sans-serif; background:var(--bg); color:var(--text); }
.app { max-width:480px; margin:0 auto; min-height:100vh; background:#fff; padding-bottom:84px; }
.page { padding:16px; }
h1 { font-size:22px; margin:4px 0 12px; } h2 { font-size:17px; margin:18px 0 8px; }
.card { background:#fff; border:1px solid var(--line); border-radius:14px; padding:12px; margin-bottom:10px; }
.row { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.muted { color:var(--muted); font-size:13px; } .ok { color:var(--ok); } .error { color:var(--bad); }
.btn { background:var(--brand); color:#fff; border:0; border-radius:12px; padding:12px 16px; font-size:16px; cursor:pointer; width:100%; }
.btn.small { width:auto; padding:6px 12px; font-size:14px; border-radius:10px; }
.btn.ghost { background:var(--brand-soft); color:var(--brand); }
.btn.danger { background:#fdecea; color:var(--bad); }
.btn:disabled { opacity:.5; }
input, textarea { width:100%; padding:12px; border:1px solid var(--line); border-radius:10px; font-size:16px; margin-bottom:10px; font-family:inherit; }
.nav { position:fixed; bottom:0; left:50%; transform:translateX(-50%); width:100%; max-width:480px; display:flex; background:#fff; border-top:1px solid var(--line); padding-bottom:env(safe-area-inset-bottom); }
.nav a { flex:1; text-align:center; padding:12px 0; text-decoration:none; color:var(--muted); font-size:14px; }
.nav a.active { color:var(--brand); font-weight:700; }
.cups { display:flex; gap:8px; justify-content:center; margin:12px 0; }
.cup { width:44px; height:44px; border-radius:50%; border:2px dashed var(--line); display:flex; align-items:center; justify-content:center; font-size:22px; }
.cup.full { border:2px solid var(--brand); background:var(--brand-soft); }
.cup.gift { border-color:#e0a030; }
.gift-banner { background:#fff2d6; border:1px solid #f0c060; border-radius:12px; padding:10px; text-align:center; font-weight:700; }
.qr { width:100%; max-width:340px; display:block; margin:8px auto; image-rendering:pixelated; }
.chips { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:8px; }
.chip { padding:6px 12px; border-radius:10px; border:1px solid var(--line); cursor:pointer; font-size:14px; }
.chip.on { background:var(--brand-soft); border-color:var(--brand); color:var(--brand); }
.tag { background:var(--brand-soft); color:var(--brand); border-radius:6px; padding:1px 6px; font-size:12px; }
.status { font-size:12px; padding:4px 8px; border-radius:8px; background:var(--brand-soft); }
.status.off { background:#fdecea; color:var(--bad); }
.sheet-bg { position:fixed; inset:0; background:rgba(0,0,0,.45); display:flex; align-items:flex-end; justify-content:center; z-index:10; }
.sheet { background:#fff; width:100%; max-width:480px; border-radius:20px 20px 0 0; padding:16px; max-height:90vh; overflow:auto; }
.video { width:100%; border-radius:12px; background:#000; aspect-ratio:1; object-fit:cover; }
.big { font-size:36px; font-weight:800; text-align:center; }
.cashback { background:#e8f5e9; border:1px solid #a5d6a7; border-radius:12px; padding:10px; text-align:center; }
```

### 6.19 `frontend/src/App.tsx`
```tsx
import { NavLink, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { getJwt } from './api'
import CardPage from './pages/CardPage'
import CashierPage from './pages/CashierPage'
import LoginPage from './pages/LoginPage'
import ProfilePage from './pages/ProfilePage'
import PromosPage from './pages/PromosPage'

function Layout() {
  if (!getJwt()) return <Navigate to="/login" replace />
  return (
    <div className="app">
      <Outlet />
      <nav className="nav">
        <NavLink to="/" end>Карта</NavLink>
        <NavLink to="/promos">Акции</NavLink>
        <NavLink to="/me">Профиль</NavLink>
      </nav>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<div className="app"><LoginPage /></div>} />
      <Route path="/cashier" element={<div className="app"><CashierPage /></div>} />
      <Route element={<Layout />}>
        <Route path="/" element={<CardPage />} />
        <Route path="/promos" element={<PromosPage />} />
        <Route path="/me" element={<ProfilePage />} />
      </Route>
    </Routes>
  )
}
```

### 6.20 `frontend/src/pages/LoginPage.tsx`
```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, setJwt, unwrap } from '../api'
import { useApp } from '../lib/app'

export default function LoginPage() {
  const nav = useNavigate()
  const { sync } = useApp()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [invite, setInvite] = useState(localStorage.getItem('sc-invite') ?? '')
  const [sent, setSent] = useState(false)
  const [hint, setHint] = useState('')
  const [error, setError] = useState('')

  async function send() {
    try {
      setError('')
      const r = await unwrap(api.api.auth['send-code'].$post({ json: { phone } }))
      setSent(true); setHint(r.devCode ?? '')
    } catch (e) { setError(navigator.onLine ? (e as Error).message : 'Нет интернета. Первый вход — по Wi-Fi.') }
  }

  async function verify() {
    try {
      setError('')
      const r = await unwrap(api.api.auth.verify.$post({ json: { phone, code, inviteCode: invite || undefined } }))
      setJwt(r.token)
      await sync()
      nav('/')
    } catch (e) { setError((e as Error).message) }
  }

  return (
    <div className="page">
      <h1>☕ Шестой стакан</h1>
      <p className="muted">Каждый 6-й стакан — бесплатно. Приведи друга — получай 3% с его покупок. Работает и без интернета.</p>
      <input placeholder="Телефон, например 79001234567" value={phone} onChange={(e) => setPhone(e.target.value)} />
      {!sent ? (
        <>
          <input placeholder="Код приглашения (если есть)" value={invite} onChange={(e) => setInvite(e.target.value)} />
          <button className="btn" onClick={send}>Получить код</button>
        </>
      ) : (
        <>
          {hint && <p className="muted">Режим разработки: код <b>{hint}</b></p>}
          <input placeholder="Код из SMS" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="btn" onClick={verify}>Войти</button>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  )
}
```

### 6.21 `frontend/src/pages/CardPage.tsx`
```tsx
import { useState } from 'react'
import Qr from '../components/Qr'
import ScanModal from '../components/ScanModal'
import { useApp } from '../lib/app'
import { addReceipt } from '../lib/customer'
import { activeVouchers, freeAvailable, progress } from '../lib/proof'

export default function CardPage() {
  const { dir, me, best, syncing, lastSync, sync, reload } = useApp()
  const [scan, setScan] = useState(false)
  const [msg, setMsg] = useState('')

  const N = dir?.cupsForFree ?? 5
  const online = Date.now() - lastSync < 5 * 60_000

  async function onScan(text: string) {
    setScan(false)
    const r = await addReceipt(text, dir, me)
    setMsg(r.ok ? '✅ Чек принят, карта обновлена' : r.reason)
    if (r.ok) await reload()
  }

  return (
    <div className="page">
      <div className="row">
        <h1>Моя карта {me && `№${me.id}`}</h1>
        <span className={'status' + (online ? '' : ' off')}>{syncing ? 'синхронизация…' : online ? 'на связи' : 'офлайн'}</span>
      </div>

      {dir?.promos[0] && (
        <div className="card">
          <b>{dir.promos[0].emoji} {dir.promos[0].title}</b>
          <div className="muted">{dir.promos[0].body}</div>
        </div>
      )}

      {!best ? (
        <div className="card">
          <b>Карта ещё не загружена</b>
          <p className="muted">Подключитесь к Wi-Fi кофейни один раз — карта сохранится и дальше будет работать без интернета.</p>
          <button className="btn" onClick={() => sync()}>Загрузить карту</button>
        </div>
      ) : (
        <>
          <div className="cups">
            {Array.from({ length: N }, (_, i) => (
              <div key={i} className={'cup' + (i < progress(best.state, N) ? ' full' : '')}>{i < progress(best.state, N) ? '☕' : ''}</div>
            ))}
            <div className={'cup gift' + (freeAvailable(best.state, N) > 0 ? ' full' : '')}>🎁</div>
          </div>

          {freeAvailable(best.state, N) > 0
            ? <div className="gift-banner">Следующий стакан бесплатно! (доступно: {freeAvailable(best.state, N)})</div>
            : <p className="muted" style={{ textAlign: 'center' }}>До бесплатного стакана: {N - progress(best.state, N)}</p>}

          {best.state.cb > 0 && (
            <div className="cashback">
              💰 Кэшбэк: <b>{best.state.cb} ₽</b>
              <div className="muted">Можно списать на кассе</div>
            </div>
          )}

          <Qr value={best.token} />
          <p className="muted" style={{ textAlign: 'center' }}>Покажите этот код кассиру</p>

          <h2>Мои купоны</h2>
          {activeVouchers(best.state).length === 0 && <p className="muted">Пока нет. Новые приходят при синхронизации.</p>}
          {activeVouchers(best.state).map((v) => (
            <div key={v[0]} className="card row">
              <b>{v[1] === 'p' ? `Скидка ${v[2]}%` : `Скидка ${v[2]} ₽`}</b>
              <span className="muted">до {new Date(v[3] * 86_400_000).toLocaleDateString()}</span>
            </div>
          ))}

          <details><summary className="muted">Технический код карты</summary>
            <textarea readOnly value={best.token} rows={4} onFocus={(e) => e.target.select()} />
          </details>
        </>
      )}

      {msg && <p className={msg.startsWith('✅') ? 'ok' : 'error'}>{msg}</p>}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" onClick={() => { setMsg(''); setScan(true) }}>📷 Сканировать чек</button>
        <button className="btn ghost" onClick={() => sync()}>🔄</button>
      </div>
      {scan && <ScanModal title="Наведите камеру на QR кассира" onResult={onScan} onClose={() => setScan(false)} />}
    </div>
  )
}
```

### 6.22 `frontend/src/pages/PromosPage.tsx`
```tsx
import { useApp } from '../lib/app'

export default function PromosPage() {
  const { dir } = useApp()
  return (
    <div className="page">
      <h1>Акции</h1>
      {!dir && <p className="muted">Акции загрузятся при первом подключении.</p>}
      {dir?.promos.map((p) => (
        <div key={p.id} className="card">
          <div className="row"><b>{p.emoji} {p.title}</b>{p.sponsor && <span className="tag">реклама</span>}</div>
          <div className="muted">{p.body}</div>
          {p.sponsor && <div className="muted">Партнёр: {p.sponsor}</div>}
          <div className="muted">до {new Date(p.endsAt * 1000).toLocaleDateString()}</div>
        </div>
      ))}
    </div>
  )
}
```

### 6.23 `frontend/src/pages/ProfilePage.tsx`
```tsx
import { Link, useNavigate } from 'react-router-dom'
import Qr from '../components/Qr'
import { setJwt } from '../api'
import { useApp } from '../lib/app'
import { clearUserData } from '../lib/db'

export default function ProfilePage() {
  const { me, lastSync, syncing, sync, reload } = useApp()
  const nav = useNavigate()
  const link = me ? `${location.origin}/?invite=${me.inviteCode}` : ''

  async function share() {
    if (navigator.share) await navigator.share({ title: 'Шестой стакан', text: 'Копи стаканы — каждый 6-й бесплатно! И получай 3% с покупок друзей.', url: link })
    else await navigator.clipboard?.writeText(link)
  }

  async function logout() {
    setJwt(null); await clearUserData(); await reload(); nav('/login')
  }

  return (
    <div className="page">
      <h1>{me?.nickname ?? 'Профиль'}</h1>
      <p className="muted">
        Последняя синхронизация: {lastSync ? new Date(lastSync).toLocaleString() : 'ещё не было'}
      </p>
      {me && me.cashbackBalance > 0 && (
        <div className="cashback" style={{ marginBottom: 12 }}>
          💰 Твой кэшбэк: <b>{me.cashbackBalance} ₽</b>
        </div>
      )}
      <button className="btn ghost" disabled={syncing} onClick={() => sync()}>🔄 Синхронизировать</button>

      <h2>Приведи друга — получай 3%</h2>
      <p className="muted">Друг регистрируется по твоей ссылке или QR. С каждой его покупки тебе начисляется 3% кэшбэком. Навсегда.</p>
      {link && (
        <>
          <Qr value={link} />
          <input readOnly value={link} onFocus={(e) => e.target.select()} />
          <button className="btn" onClick={share}>Поделиться</button>
        </>
      )}

      <h2>Для сотрудников</h2>
      <Link to="/cashier">Режим кассы →</Link>

      <button className="btn danger" style={{ marginTop: 24 }} onClick={logout}>Выйти</button>
    </div>
  )
}
```

### 6.24 `frontend/src/pages/CashierPage.tsx`
```tsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Qr from '../components/Qr'
import ScanModal from '../components/ScanModal'
import { useApp } from '../lib/app'
import { createReceipt, enroll, loadCreds, syncCashier, type DeviceCreds } from '../lib/cashier'
import { getSeen } from '../lib/db'
import { activeVouchers, discountFor, freeAvailable, progress, verifyProof } from '../lib/proof'
import type { CardState, Directory, ReceiptPayload } from '../lib/types'

export default function CashierPage() {
  const { dir, reload } = useApp()
  const [creds, setCreds] = useState<DeviceCreds | null | undefined>(undefined)

  useEffect(() => { loadCreds().then((c) => setCreds(c ?? null)) }, [])

  useEffect(() => {
    if (!creds) return
    const run = () => { void syncCashier(creds).then(reload) }
    run()
    const t = setInterval(run, 30_000)
    return () => clearInterval(t)
  }, [creds, reload])

  if (creds === undefined) return <div className="page muted">Загрузка…</div>
  if (!creds) return <Enroll onDone={setCreds} />

  return (
    <div className="page">
      <div className="row"><h1>Касса · {creds.storeName}</h1><Link to="/">←</Link></div>
      {!dir ? <p className="error">Нет справочника. Подключитесь к интернету один раз.</p>
        : <Sale creds={creds} dir={dir} />}
    </div>
  )
}

function Enroll({ onDone }: { onDone: (c: DeviceCreds) => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  return (
    <div className="page">
      <h1>Регистрация кассы</h1>
      <p className="muted">Введите код от владельца. Нужен интернет (один раз).</p>
      <input placeholder="Код, например DEMO1234" value={code} onChange={(e) => setCode(e.target.value)} />
      <button className="btn" onClick={async () => {
        try { onDone(await enroll(code)) } catch (e) { setError((e as Error).message) }
      }}>Зарегистрировать</button>
      {error && <p className="error">{error}</p>}
    </div>
  )
}

function Sale({ creds, dir }: { creds: DeviceCreds; dir: Directory }) {
  const N = dir.cupsForFree
  const [stage, setStage] = useState<'idle' | 'scan' | 'form' | 'done'>('idle')
  const [state, setState] = useState<CardState | null>(null)
  const [error, setError] = useState('')
  const [stale, setStale] = useState<string | null>(null)
  const [cups, setCups] = useState(1)
  const [useFree, setUseFree] = useState(false)
  const [voucherId, setVoucherId] = useState<number | null>(null)
  const [cashbackUse, setCashbackUse] = useState(0)
  const [amount, setAmount] = useState(0)
  const [result, setResult] = useState<{ token: string; payload: ReceiptPayload } | null>(null)

  async function onScan(text: string) {
    setError(''); setStale(null)
    const v = verifyProof(text, dir)
    if (!v) { setError('Код не распознан или подпись неверна.'); setStage('idle'); return }

    const seen = await getSeen(v.payload.u)
    if (seen && v.payload.q < seen.q) { setStale(seen.token); setStage('idle'); return }

    setState(v.payload); setCups(1); setUseFree(false); setVoucherId(null); setCashbackUse(0); setAmount(0); setStage('form')
  }

  async function confirm() {
    if (!state) return
    const r = await createReceipt(creds, state, { cups, useFree, voucherId, cashbackUse, amount })
    setResult(r); setStage('done')
  }

  if (stage === 'done' && result) {
    const p = result.payload
    return (
      <>
        <div className="card">
          <b>Чек создан · клиент №{p.u}</b>
          <div>Стаканов: {p.p} (прогресс {progress(p, N)}/{N}){p.df ? ' · выдан бесплатный' : ''}</div>
          {p.dcb > 0 && <div>Списано кэшбэка: {p.dcb} ₽</div>}
        </div>
        <p className="muted">Пусть клиент нажмёт «Сканировать чек»:</p>
        <Qr value={result.token} />
        <details><summary className="muted">Технический код чека</summary>
          <textarea readOnly value={result.token} rows={4} onFocus={(e) => e.target.select()} />
        </details>
        <button className="btn" onClick={() => setStage('idle')}>Готово</button>
      </>
    )
  }

  if (stage === 'form' && state) {
    const vouchers = activeVouchers(state)
    const voucher = vouchers.find((v) => v[0] === voucherId)
    const discount = discountFor(voucher, amount)
    const free = freeAvailable(state, N)
    const toPay = Math.max(0, amount - discount - cashbackUse)

    return (
      <>
        <div className="card">
          <b>Клиент №{state.u}</b>
          <div>Прогресс: {progress(state, N)}/{N} · бесплатных: {free}</div>
          {state.cb > 0 && <div className="ok">Кэшбэк на карте: {state.cb} ₽</div>}
        </div>

        <h2>Куплено оплачиваемых стаканов</h2>
        <div className="row">
          <button className="btn small ghost" onClick={() => setCups(Math.max(0, cups - 1))}>−</button>
          <div className="big">{cups}</div>
          <button className="btn small ghost" onClick={() => setCups(cups + 1)}>+</button>
        </div>

        {free > 0 && (
          <label className="card row">
            <span>🎁 Выдать бесплатный стакан</span>
            <input type="checkbox" style={{ width: 24, margin: 0 }} checked={useFree} onChange={(e) => setUseFree(e.target.checked)} />
          </label>
        )}

        <h2>Купон</h2>
        <div className="chips">
          <span className={'chip' + (voucherId === null ? ' on' : '')} onClick={() => setVoucherId(null)}>Без купона</span>
          {vouchers.map((v) => (
            <span key={v[0]} className={'chip' + (voucherId === v[0] ? ' on' : '')} onClick={() => setVoucherId(v[0])}>
              {v[1] === 'p' ? `−${v[2]}%` : `−${v[2]} ₽`}
            </span>
          ))}
        </div>

        {state.cb > 0 && (
          <>
            <h2>Списать кэшбэк, ₽</h2>
            <input type="number" inputMode="numeric" value={cashbackUse || ''} onChange={(e) => setCashbackUse(Math.min(state.cb, Math.max(0, Number(e.target.value))))} />
            <div className="muted">Максимум: {state.cb} ₽</div>
          </>
        )}

        <h2>Сумма по чеку, ₽</h2>
        <input type="number" inputMode="numeric" value={amount || ''} onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))} />
        <div className="card">
          {discount > 0 && <div className="ok">Скидка по купону: −{discount} ₽</div>}
          {cashbackUse > 0 && <div className="ok">Кэшбэк: −{cashbackUse} ₽</div>}
          <div className="big">К оплате: {toPay} ₽</div>
        </div>

        <button className="btn" disabled={cups === 0 && !useFree && !voucher && cashbackUse === 0} onClick={confirm}>
          Подтвердить и создать чек
        </button>
        <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setStage('idle')}>Отмена</button>
      </>
    )
  }

  return (
    <>
      <button className="btn" onClick={() => setStage('scan')}>📷 Сканировать карту клиента</button>
      {error && <p className="error">{error}</p>}
      {stale && (
        <div className="card">
          <b className="error">Карта клиента устарела</b>
          <p className="muted">Пусть клиент отсканирует актуальный чек, а потом покажет карту снова:</p>
          <Qr value={stale} />
        </div>
      )}
      {stage === 'scan' && <ScanModal title="Отсканируйте QR карты клиента" onResult={onScan} onClose={() => setStage('idle')} />}
    </>
  )
}
```

---

## 7. Шаг 4. Установка и запуск

```bash
npm install
npm run icons -w frontend
npm run typecheck
npm run dev
```

Открой **http://localhost:5173**.

### Пошаговая проверка

Нужны два профиля браузера (или обычное + инкогнито).

**А. Касса**  
1. `http://localhost:5173/cashier`  
2. Код `DEMO1234` → «Зарегистрировать».

**Б. Клиент**  
1. `http://localhost:5173` → телефон → код (показан на экране) → войти.  
2. Карта + купон «−10%».

**В. Покупка ОФЛАЙН**  
1. В обоих профилях: DevTools → Network → Offline.  
2. Клиент: скопировать технический код карты.  
3. Касса: «Ввести код вручную» → вставить → 1 стакан, 190 ₽, купон → «Подтвердить».  
4. Клиент: сканировать чек → прогресс 1/5.

**Г. 6-й бесплатно**  
Повторить ещё 4 раза. После 5-й — 🎁 и галочка «Выдать бесплатный».

**Д. Реферальный кэшбэк**  
1. В профиле клиента 1 скопировать ссылку `?invite=…`.  
2. В третьем профиле открыть ссылку → зарегистрировать друга.  
3. Друг делает покупку на 200 ₽ (офлайн → потом онлайн).  
4. После синхронизации у пригласившего появляется кэшбэк 6 ₽ (`floor(200 * 0.03)`).  
5. На кассе можно списать этот кэшбэк.

**Е. Защита от старой карты**  
Сохранить карту до бесплатного → выдать бесплатный → показать старую → касса: «Карта устарела».

**Админка (терминал):**
```bash
# новая касса
curl -s -X POST localhost:3000/api/admin/devices -H 'X-Admin-Token: dev-admin' \
  -H 'content-type: application/json' -d '{"storeId":1,"name":"Планшет 2"}'

# акция
curl -s -X POST localhost:3000/api/admin/promos -H 'X-Admin-Token: dev-admin' \
  -H 'content-type: application/json' \
  -d '{"title":"Пирожки −15%","body":"Скидка по карте","emoji":"🥧","sponsor":"Пекарня","days":14}'

# споры
curl -s localhost:3000/api/admin/disputes -H 'X-Admin-Token: dev-admin'

# кэшбэк конкретного пользователя
curl -s localhost:3000/api/admin/cashback/1 -H 'X-Admin-Token: dev-admin'
```

### Тест на телефоне
Нужен HTTPS (кроме localhost). Самый простой путь — деплой или `cloudflared tunnel --url http://localhost:5173`.  
Установка: Android Chrome → «Установить»; iPhone Safari → «На экран Домой».

---

## 8. Как всё устроено внутри

**Первый запуск (нужен интернет один раз).**  
Клиент вводит телефон → сервер создаёт пользователя, карту `p=0,f=0,q=0`, купон WELCOME, `invite_code`.  
`syncCustomer()` скачивает справочник + подписанную карту → IndexedDB.  
Service worker кэширует файлы → дальше открывается без сети.

**Покупка (без интернета).**  
1. QR клиента = самая свежая карта/чек.  
2. Касса `verifyProof()` — подпись + проверка `q`.  
3. Кассир вводит данные → `createReceipt()` подписывает ключом кассы (включая `dcb`).  
4. Клиент сканирует → `addReceipt()` → `computeBest()` показывает новое состояние.

**Синхронизация.**  
1. Чеки уходят на сервер.  
2. `applyReceipts()`: подпись → `INSERT OR IGNORE` → прибавление `dp/df` → списание `dcb` → купоны → проверка споров → **начисление 3 % пригласившему**.  
3. Новая карта с актуальным `cb` возвращается клиенту.

**Почему складываем изменения, а не перезаписываем.**  
Две кассы могут работать офлайн одновременно. Сумма `dp`/`df`/`dcb` не зависит от порядка.

**Принципы:**  
- Подпись = доверие.  
- Чеки только добавляются.  
- Уникальный id чека.  
- Любой сетевой запрос может не дойти → сначала пишем локально, потом пробуем отправить.

---

## 9. Выкладка в реальную жизнь

1. **Сервер (VPS):** `npm run build`, `npm run start -w backend`. Секреты: `JWT_SECRET`, `ADMIN_TOKEN`, `DB_PATH`, `KEYS_PATH`.  
2. **HTTPS обязателен** (PWA + камера). Caddy + Let's Encrypt → `reverse_proxy localhost:3000`.  
3. **Бэкапы:** `backend/data/` (база + `keys.json`). Без ключа карты умрут.  
4. **SMS:** заменить вывод кода на реального провайдера + лимиты.  
5. **Wi-Fi в кофейне:** гостевая сеть без captive-portal (или приложение просто посчитает «нет сети»).  
6. **Обучение кассиров:** «сканируй карту → стаканы/сумма/кэшбэк → покажи чек».  
7. **152-ФЗ:** телефоны и история покупок — уточнить у юриста (локализация, согласие, политика).

---

## 10. Что улучшить дальше

| Что | Зачем |
|---|---|
| Push (Web Push) | «Ваш кэшбэк пополнился» / «Заказ готов» |
| Веб-панель владельца | Вместо curl: акции, кассы, споры, отчёты по кэшбэку |
| Авто-скидки по времени | Правила в справочнике, касса считает офлайн |
| Лимит бесплатных в сутки на кассе | Меньше злоупотреблений |
| NFC / Bluetooth вместо QR | Удобнее в очереди |
| Postgres | Когда точек станет много |
| Тесты (Vitest) | `applyReceipts`, `verifyProof`, `cashbackOf`, `freeAvailable` |
| WebCrypto для ключа кассы | Неэкспортируемый ключ там, где поддерживается |

---

**Готово.** Гайд того же объёма и качества, но проще: убраны заказы, добавлен постоянный 3 % реферальный кэшбэк, всё остальное — offline-first лояльность с QR и подписями.

# Android / external cashier — API contract

Этот документ для **следующего** этапа (отдельное Android-приложение).  
В текущем репозитории Android **не** реализуется.

Base URL (production): `https://<your-domain>`  
Dev: `http://<lan-ip>:3000`

## Auth

| Role | Header | Как получить |
|------|--------|----------------|
| Device (касса) | `X-Device-Token: <token>` | `POST /api/devices/enroll` |
| Admin | `X-Admin-Token: <secret>` | env `ADMIN_TOKEN` |
| Customer | `Authorization: Bearer <jwt>` | `POST /api/auth/verify` |

Нет refresh-token у device: при компрометации — revoke в admin.

## Directory (каталог + ключи)

```http
GET /api/directory
```

Без auth. Ответ (ключевые поля):

```json
{
  "serverPub": "...",
  "cupsForFree": 5,
  "referralCashbackPercent": 3,
  "currency": "RUB",
  "generatedAt": 1710000000,
  "devices": [{ "id": 1, "pub": "...", "revoked": false }],
  "stores": [{ "id": 1, "name": "...", "address": "...", "organizationId": 1 }],
  "organizations": [{
    "id": 1,
    "name": "...",
    "legalName": "...",
    "taxRegime": "usn_income",
    "vatRate": 0
  }],
  "categories": [{ "id": 1, "name": "Напитки", "sortOrder": 0 }],
  "products": [{
    "id": 1,
    "name": "Капучино",
    "price": 190,
    "icon": "CupSoda",
    "description": "...",
    "categoryId": 1,
    "imageUrl": "/uploads/....jpg",
    "sortOrder": 0
  }],
  "promos": []
}
```

### Цена

`price` — **целые рубли** (190 = 190 ₽), не копейки.

### Налог

На уровне **organization**: `taxRegime`, `vatRate` (0 | 10 | 20).  
Товарного НДС в API нет — наследование через store → organization.

`taxRegime` values: `usn_income` | `usn_income_expense` | `osn` | `patent`.

### Картинки

`imageUrl` относительный путь, например `/uploads/171-abc.jpg`.  
Полный URL: `https://<domain>` + `imageUrl`.

## Device enrollment

```http
POST /api/devices/enroll
Content-Type: application/json

{ "code": "DEMO1234", "publicKey": "<43-char base64url Ed25519 pub>" }
```

Ответ:

```json
{ "deviceId": 1, "deviceToken": "...", "storeName": "..." }
```

Код выпускается в `/admin` → Кассы.

## Loyalty sync (не фискальный чек)

```http
POST /api/devices/sync
X-Device-Token: ...
{ "receipts": [ "<signed-token>", ... ] }
```

Формат signed receipt — как в PWA (`frontend/src/lib/cashier.ts`).  
Фискальная продажа Эвотор **не** описана этим контрактом.

## Health

```http
GET /health → { "ok": true }
```

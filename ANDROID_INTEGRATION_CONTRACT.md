# Android / Evotor cashier integration — current contract

Android APK 6.7 runs **inside the Evotor smart terminal** as an Evotor application. It is not a separate fiscal cash register.

## Catalog ownership

### Evotor Cloud is authoritative for

- stores/trading points;
- employees;
- base product/nomenclature objects;
- Evotor product UUIDs;
- base price, tax, measure and sell availability.

### 6.7 backend is authoritative for

- local product id;
- recipe;
- modifier/topping scheme;
- `countsAsCup` / `freeEligible`;
- seasonal availability;
- cost data;
- custom JSON metadata.

## Product lifecycle

```text
6.7 Admin creates Product
        ↓
local products.id
        ↓
POST Cloud /stores/{store}/products without product id
        ↓
Evotor Cloud assigns product UUID
        ↓
store in product_store_links + evotor_products
        ↓
POST ProductExtra with recipe/toppings
        ↓
Evotor Cloud → terminal inventory
        ↓
6.7 APK InventoryApi
```

After the first successful CREATE, the saved Evotor UUID is never regenerated. Product changes use PUT with that UUID. If the CREATE response is lost, the backend searches the remote catalog by stable `article_number=sc-<localProductId>` before attempting another CREATE.

Incoming Evotor products are upserted by `(store_uuid, evotor_uuid)`. Products that originated only in Evotor are stored as `EVOTOR_IMPORT` until an administrator edits them in 6.7.

## Product metadata on terminal

6.7 sends a `ProductExtra` named `sixthcup` containing JSON such as:

```json
{
  "schema": "6.7.product.v1",
  "productUuid": "<evotor-uuid>",
  "countsAsCup": true,
  "freeEligible": true,
  "recipe": "18g espresso + 180ml milk",
  "recipeCostRub": 53,
  "recipeSeconds": 90,
  "toppings": [
    { "id": 1, "name": "Ваниль", "priceRub": 30, "groupKey": "syrup" }
  ]
}
```

On the terminal `EvotorCatalogActivity` reads the real local Evotor inventory using `InventoryApi`, resolves the selected product by UUID and reads `InventoryApi.getProductExtras()` to display the 6.7 metadata.

## Adding a product to the receipt

The APK is registered for Evotor's `ru.evotor.createPosition` ActivityResult integration.

It returns an ordinary `ru.evotor.framework.receipt.Position` whose `productUuid` is an existing terminal-inventory UUID. EvotorPOS then places the position in the current receipt and remains responsible for fiscalization.

## Loyalty customer identity

Two supported channels:

1. **Preferred:** signed customer QR. The APK verifies the Ed25519 signature, expiry and key id before keeping the token in an in-memory sale session.
2. **Fallback:** numeric short card code, entered manually or received from a scanner. Leading zeroes are preserved in the terminal session; backend normalization resolves `0042` and `42` to the same card.

The APK writes the selected value to `extras.sc.c`. It may also write `kind=token|code`.

The server is the loyalty source of truth. After fiscal `SELL`, Cloud polling passes the document to `SellHandler`, which resolves the token/card code, applies idempotent loyalty operations and records disputes for invalid/stale claims.

## Security / secrets

- No Evotor API token is stored in the APK.
- The server `EVOTOR_API_TOKEN` remains backend-only.
- The Android build receives only the Ed25519 **public** key and key id needed to verify signed customer QR.
- No `.env` or private signing key belongs in either repository.

## Till event log — `POST /api/devices/logs`

The terminal reports important events so they appear in the admin panel (Логи → «Касса»).
Same auth and headers as `/api/devices/loyalty/resolve`:

```
POST /api/devices/logs
Authorization: <EVOTOR_PROXY_TOKEN>            (required; 403 without it, 503 if the server has no token)
X-Evotor-Store-Uuid: <store uuid>              (optional, only the first 4 chars are logged)
X-Evotor-Device-UUID: <device uuid>            (optional, only the first 4 chars are logged)
Content-Type: application/json

{ "level": "info|warn|error", "message": "scan QR", "meta": { "code": "0042", "kind": "token" } }
or a batch (≤ 20, e.g. flushed after being offline):
{ "entries": [ { "level": "...", "message": "...", "meta": {...} }, ... ] }
```

Limits: body ≤ 16 KB, message ≤ 500 chars, 120 requests/min per device. Answers `{ "ok": true }`.

Recommended events: `scan QR`, `resolve ok` / `resolve fail` (+ `error`), `discount applied` (free / cashback),
`sell extras written`. Fire-and-forget — a failed log request must never block a sale.

**Never send** the QR/card token, `Authorization`, device token or any secret. A card code may be sent as
`meta.code` (short numeric code only): the server stores just `••NN` (last two digits). Meta keys containing
`token`, `secret`, `password`, `authorization`, `cookie`, `jwt`, `qr`, `payload`, `proof` are always dropped, and
long token-like strings are redacted server-side as a safety net.

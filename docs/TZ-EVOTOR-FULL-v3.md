# 6.7 Coffee — Evotor integration MASTER TZ v3

> This document supersedes the unfinished V2 draft. The primary technical contract is the real Phase-0 v1 behaviour recorded in `EVOTOR-FACTS.md`.

## 1. Architecture

Backend is the source of truth for catalogue, loyalty and history.

Evotor Cloud v1 is the fiscal/data integration layer.

The Android app on Evotor is a cashier-side adapter. It does not own customer state.

The customer PWA is independent from Evotor.

## 2. API contract

Current production contract:

- `/api/v1/inventories/stores/search`;
- `/api/v1/inventories/employees/search`;
- `/api/v1/inventories/stores/{store}/products`;
- `/api/v1/inventories/stores/{store}/documents`;
- `X-Authorization`;
- `gtCloseDate` / `ltCloseDate` as `YYYY-MM-DD`;
- `transactions[]` in actual document responses.

Do not silently switch the implementation to V2.

## 3. Stores

Each store has independent sync state.

HTTP 402 for one store must not stop other stores.

Sync state records:

- last successful close date/time;
- last fast run;
- last hourly run;
- last daily run;
- status;
- last error.

## 4. Polling

Fast: every 60 seconds with overlap.

Hourly: wider reconciliation window.

Daily: 7-day reconciliation by default.

Manual endpoint remains available to force a poll.

All document inserts are idempotent by `(store_uuid, doc_id)`.

## 5. Document model

Supported loyalty document types:

- SELL;
- PAYBACK.

SELL data is read from `transactions[]` in the actual v1 response.

PAYBACK must resolve `baseDocumentUUID` and reverse the original loyalty operation.

Unknown or non-loyalty documents are retained as `IGNORED`/processed and never affect loyalty.

## 6. Loyalty QR

QR version 2:

```json
{
  "t":"c",
  "ver":2,
  "kid":"k-...",
  "id":"opaque-card-id",
  "q":12,
  "p":25,
  "f":4,
  "v":[],
  "cb":8000,
  "i":1790000000,
  "exp":1790086400
}
```

It is Ed25519 signed.

`id` is random and contains no user id, phone or card sequence.

`kid` allows key rotation.

`exp` limits replay.

## 7. Loyalty arithmetic

`CUPS_FOR_FREE = 5` means the sixth cup is free.

```text
freeEarned = floor(paidTotal / 5)
freeAvailable = max(0, freeEarned - freeUsed)
progress = paidTotal % 5
```

Never use `paidTotal % 6`.

Cashback is stored internally in **kopecks**.

All API/UI conversion to rubles must divide by 100.

## 8. Android cashier app

The app:

- accepts only a structurally valid signed QR;
- keeps the current customer in memory only;
- applies discount through `ReceiptDiscountEvent`;
- writes `extras.sc`;
- clears customer state after discount attempt;
- has no `INTERNET` permission;
- has no manual numeric card input.

`extras.sc` is not trusted by itself on backend. Backend re-verifies `c` and checks current card sequence.

## 9. Backend loyalty processing

SELL:

1. read `extras.sc`;
2. verify card token;
3. resolve opaque card id;
4. compare `q` with current sequence;
5. count eligible cups from Evotor product mapping;
6. clamp free/cashback claims to current state;
7. update card/user state atomically;
8. write ledger;
9. write loyalty operation;
10. write dispute if a claim was clamped or stale.

PAYBACK:

1. read `baseDocumentUUID`;
2. resolve original SELL loyalty operation;
3. reverse cups/free/cashback atomically;
4. reverse referral cashback ledger entries;
5. write reversal ledger and PAYBACK operation.

## 10. Product synchronisation

Backend product id is canonical.

Evotor UUID is deterministic UUIDv5:

```text
UUIDv5(namespace, storeUuid + ':' + productId)
```

Changes enter `evotor_outbox`.

Outbox retries with exponential delay.

Product payload includes:

- name;
- price;
- measure;
- tax;
- cost price;
- allowToSell;
- deterministic uuid.

Seasonal products are represented through `season_start_at` / `season_end_at` and `allowToSell`.

## 11. Product extras

The backend supports official v1 product extras:

```text
POST /api/v1/inventories/stores/{store}/products/extras
```

`products.evotor_extra_json` contains structured JSON for recipe/topping metadata.

The API response must be verified on the real test store before declaring Phase 0.5 complete.

## 12. Security

Forbidden:

- SMS login;
- public numeric card lookup;
- user id in QR;
- phone in QR;
- secrets in source;
- direct APK → backend HTTP;
- accepting arbitrary scanner text;
- persisting customer QR in SharedPreferences;
- trusting client-provided loyalty amounts without server validation.

## 13. Testing

Backend:

- `tsc --noEmit`;
- unit tests for free-cup arithmetic;
- signed QR tests;
- expired QR tests;
- wrong-kid tests;
- stale sequence tests;
- SELL idempotency;
- PAYBACK reversal;
- cashback kopeck/ruble conversion;
- UUIDv5 stability;
- outbox retry;
- product drift.

Real Evotor tests:

- product POST;
- product extras POST/GET;
- APK scan;
- ReceiptDiscountEvent;
- `extras.sc` visibility;
- SELL;
- PAYBACK;
- offline delay;
- 402 store isolation;
- 429 handling.

## 14. Known external blockers

These cannot be proven from source code alone:

1. whether the installed APK's `extras.sc` is visible through this account's v1 document API;
2. exact production permissions granted to the Evotor application;
3. behaviour of the physical terminal in offline mode;
4. actual 429 limits;
5. fiscal/legal treatment of marked goods.

These are explicit acceptance tests, not implementation assumptions.

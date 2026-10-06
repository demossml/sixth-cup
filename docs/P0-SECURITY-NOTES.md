# P0 security — current state

## Implemented

- Anonymous guest accounts; real phone/SMS is not required.
- Signed customer QR uses Ed25519, key id and expiry.
- Numeric card code is a controlled fallback; backend resolves it and never trusts terminal loyalty state.
- `extras.sc` is re-verified on the server after fiscal SELL.
- Loyalty operations are idempotent by `(store, document)`.
- Card QR is kept in Android memory only; no customer token in SharedPreferences.
- Public directory does not expose recipe metadata.
- Backend rate-limits guest/card lookup endpoints.

## Remaining production gates

- Real ST5 terminal test.
- Confirm the physical Cloud document contains `extras.sc` exactly as written by the APK.
- Confirm ProductExtra delivery and local InventoryApi visibility on the physical terminal.
- Production privacy/legal review before scaling customer analytics.

# 6.7 — manual card input

- Restored manual short card-number entry in the Evotor app alongside signed QR.
- Android accepts digits-only input and digit-only scanner results; signed QR still requires Ed25519 verification.
- `extras.sc.c` now carries either the signed token or the short numeric code; `kind` is informational.
- Android `versionCode` is **52**, `versionName` is **2.3.1-card-manual**.
- Added `users.card_code` with stable sequential assignment for existing/new guests.
- Backend normalizes leading zeroes and resolves codes by exact value / numeric CAST.
- Unknown codes create a dispute and return `processed:false`; polling does not throw.
- PWA shows the card number next to the signed QR.
- Manual-code mode applies no offline loyalty discount; server remains the source of truth after fiscal SELL.

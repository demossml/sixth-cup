# Sixth Cup — implemented customer mechanics

This build adds the new customer flow on top of the existing loyalty/cashier core.

## Implemented

- Automatic anonymous customer account creation at first app launch.
- Optional `?invite=...` is consumed during automatic account creation.
- Existing SMS login remains available at `/login` as a legacy/recovery path.
- Persistent local account storage in IndexedDB with JWT runtime mirror.
- Customer referral QR at `/invite`.
- Referral relationship uses the existing `users.invited_by` field.
- Existing 3% referral cashback engine is preserved.
- Aggregated referral statistics: total cashback from friends + friend count.
- No individual friend identity or per-friend amounts are returned to the client.
- One-time account recovery QR at `/save-account` and `/recover?token=...`.
- Recovery tokens are stored only as SHA-256 hashes and previous active tokens are revoked when a new one is generated.
- Save-account banner appears from the second app launch until dismissed/saved.
- Existing menu, promos, cards, receipts, offline sync and cashier mechanisms are retained.

## Important deployment note

The first-ever automatic account creation requires network access because the server must create the account and issue the JWT. After that, the customer app keeps working from the existing offline cache as before.

## Validation performed in this environment

- SQLite base schema + recovery migration: passed.
- TypeScript parser-level check: no syntax diagnostics found in modified TS/TSX files.
- Full `npm run typecheck` / production build could not be executed in this environment because the archive's dependency tree was not installed and package installation timed out. Run `npm install`, then `npm run typecheck`, `npm test -w backend`, and `npm run build` on the development machine before production deployment.

# Align backend + admin + PWA with the Evotor till (2026-10-10)

Backend parsing of the SELL document (nested `extras[appId].sc`, `uuid`, `commodityUuid`, numeric strings,
money scale) was already in the archive. This change closes what was still open.

## Backend
- `SellHandler.ts`: `sellInternals` export so tests run the real helpers (old tests checked local copies).
- `modules/admin/routes.ts`: **bug** — a new product got `id = NaN` (`Number({id})`), so store assignment and sync from the
  admin UI silently skipped it. Fixed. New products with no explicit choice get `counts_as_cup` by the drink rule
  (`looksLikeDrink`, same rule as migration 004).
- `modules/admin/assignments.ts`: **bug** — `/sales/summary` queried non-existent `evotor_documents` / `last_poll_at`
  inside a swallowing try/catch, so "Документов SELL" and "poll" were always empty. Now `evotor_docs` +
  `evotor_sync_state.last_fast_at/last_hourly_at`; adds `sellFailed` and `loyalty {ops,cups,lastOpAt}`.
- New `GET /api/admin/loyalty/ops?limit=` — last credited operations (doc, card, cups, free, cashback, ₽).

## Admin
- Product editor: checkbox **«Считается стаканом»** (sent as `countsAsCup`); list shows the state per product.
- «Продажи»: SELL docs / failed, credited ops and cups for 24 h, list of the latest loyalty ops.

## Client PWA
- No change needed: it already renders `cupsTowardFree/cupsForFree`, `freeAvailable`, cashback (kopecks → ₽) from
  `/api/sync` and re-syncs on `visibilitychange`, `online` and every 60 s.

## Tests
- `evotor-position-fields.test.ts` rewritten against the real helpers; new `sell-fixture.test.ts` runs the ТЗ document
  end-to-end (2 cups, 300 ₽, idempotency, counts_as_cup=0, unknown card, admin endpoints, PWA state).
- backend: 55 passed. `npm run typecheck` and `npm run build` green.

## Migrations
None.

## Known limits
- Money heuristic: unit price ≥ 1000 ⇒ already kopecks. A store that works in rubles and sells an item ≥ 1000 ₽
  would be read as kopecks (affects `result_rub`/cashback base only, not cups).
- A manually typed numeric card code identifies the card for accrual only (resolve returns cashback 0 and never
  reserves bonuses) — by design, unchanged.
- Old SELL documents already marked PROCESSED without loyalty are not re-processed (needs a refetch script).

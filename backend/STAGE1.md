# Stage 1 — Backend Foundation

## Added
- `schema_migrations` + SQL migrations in `src/db/migrations/`
- `organizations` (tax_regime, vat_rate, inn, …)
- `stores.organization_id`
- `categories`
- product fields: description, category_id, image_url, sort_order, timestamps
- Admin API: organizations, stores CRUD, categories CRUD, extended products
- `POST /api/admin/upload` — local disk under `data/uploads`, public `/uploads/*`
- Directory: organizations, categories, product extras (legacy fields kept)
- Seed: default org, categories, linked stores
- Tests: `npm run test -w backend`
- Script: `backend/scripts/create-demo-business.ts`

## Not changed
- Frontend
- Loyalty / devices enroll / auth
- Evotor

## Tax regimes
`usn_income` | `usn_income_expense` | `osn` | `patent`  
`vat_rate`: 0 | 10 | 20 (integer percent)

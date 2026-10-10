# Admin redesign (phases 0–3 partial)

## Backend (`modules/admin/redesign.ts`)
- GET `/api/admin/dashboard`
- GET `/api/admin/evotor/health`
- GET `/api/admin/operations` + `/operations.csv` + `/operations/:store/:doc`
- GET `/api/admin/customers` + `/customers/:id`
- PATCH `/api/admin/products/:id`
- POST `/api/admin/products/bulk`
- GET `/api/admin/audit`
- GET `/api/admin/voucher-templates`
- POST `/api/admin/customers/:id/vouchers`

## Frontend-admin
- HashRouter: `#/`, `#/operations`, `#/customers`, `#/menu/products`, `#/evotor`, `#/marketing`, `#/system`, `#/legacy`
- Legacy full AdminPage preserved
- No phone in customer list

## Not in this drop
- Full groups/modifiers new UI (redirect to legacy)
- admin_tokens / roles
- SELL retry button
- Strict ADMIN_ALLOW_RESET wiring (document in deploy)

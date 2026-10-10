# Apply admin redesign

1. Replace/merge monorepo from this archive onto your repo (prefer file copy for new paths).
2. Ensure `backend/src/modules/admin/routes.ts` mounts `adminRedesign` before or after assignments.
3. `npm ci && npm run typecheck && npm run test -w backend && npm run build`
4. Deploy Mac mini: pull, build, restart `sixth-cup-api`; set `ADMIN_ALLOW_RESET=0` in `.env` for production.
5. Open `https://admin.67coffee.ru/#/` with ADMIN_TOKEN.

New UI routes (hash): `#/`, `#/operations`, `#/customers`, `#/menu/products`, `#/evotor`, `#/marketing`, `#/system`, `#/legacy`.

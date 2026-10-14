# Merge: alpaca runner v7 + admin mobile/DeepSeek

## Base
`sixth-cup-admin-mobile-deepseek.zip` (admin mobile fix + Система → ИИ / DeepSeek + analytics/AI).

## From Claude `sixth-cup-alpaca-runner-v7.zip`
- Full Phaser runner: `frontend/src/game/alpaca/**`, `components/game/**`, `GamePage.tsx`
- Assets + `docs/alpaca-7/`, `REPORT-ALPACA-7.md`
- `runnerApi` / `runnerQueue` / `gameApi` / `gameQueue`
- Backend: `modules/game/routes.ts`, `runner.ts` (MAX_BEANS=30)
- Migrations `014_alpaca_game`, `015_runner_stats`
- Route `/game`, More → «Приключения ламы»
- dependency `phaser@3.80.1`

## Not overwritten
- frontend-admin (mobile + DeepSeek settings)
- admin analytics / AI modules
- Evotor / loyalty contracts

## After deploy
1. `npm ci` (pulls phaser)
2. Migrations 014–016 apply on API start
3. Client: Ещё → Приключения ламы
4. Admin: Система → ИИ for DeepSeek key

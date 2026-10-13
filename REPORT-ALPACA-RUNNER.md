# Отчёт: 2D-аркада «Приключения ламы»

## Реализовано
- Phaser 3 runner: бег, прыжок, скольжение, зёрна, crate, overhead, финиш, пауза, win/lose
- React: AlpacaGameCanvas (один instance, destroy on unmount), GameOverlay, GamePage
- Backend: runner_runs + runner_progress, идемпотентный runId, без loyalty
- Offline queue: sc_runner_pending_v1

## Файлы (новые)
frontend/src/game/alpaca/**, components/game/**, lib/runnerApi.ts, lib/runnerQueue.ts
backend/src/modules/game/runner.ts, migrations/015_runner_stats.sql

## Изменённые
frontend/package.json (phaser@3.80.1), App route /game, MorePage, GamePage.tsx (замена card-match UI)
backend app.ts mount

## Зависимости
phaser@3.80.1 — игровой движок по ТЗ

## Не сделано / ограничения
- assemble/typecheck в этой среде без полного npm ci phaser может требовать install на машине агента
- Баланс уровня — стартовые константы из ТЗ
- Звук отключён (noAudio)

## Запуск
Ещё → Приключения ламы → Играть. Space/тап прыжок, ↓/свайп вниз скольжение.

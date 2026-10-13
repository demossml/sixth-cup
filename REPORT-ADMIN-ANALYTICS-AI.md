# REPORT: KPI, графики, AI, роли

## Сделано
- A: `analytics/series`, `analytics/by-store`, графики SVG на Сегодня и Сравнение, Δ%, `docs/METRICS.md`
- B: `/referrals/summary` + UI таблица; события с фильтром; copy availability «не меню Эвотор»
- C: AI routes + страница Помощник (mock/remote), `docs/AI-ASSISTANT.md`
- D: роль manager (`ADMIN_MARKETER_TOKEN`), расширенный `/me`, CTA на quality → помощник

## Не сделано / ограничения
- Полевые E1/E2 (QR ST5, offline QA) — процесс
- B4-b push disable в Эвотор — не делали
- Полноценный RBAC в БД — только env-токены
- recharts не подключали — SVG без новых deps

## Проверка
```bash
npm ci && npm run typecheck && npm run test -w backend && npm run build
```
Env optional: `ADMIN_MARKETER_TOKEN`, `AI_ASSISTANT=1`, `AI_API_KEY`

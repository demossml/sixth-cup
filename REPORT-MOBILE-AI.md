# Mobile admin + DeepSeek settings

## 1. Mobile admin
- Bottom tab bar: smaller labels, truncate, safe-area padding, no horizontal page scroll
- Main: overflow-x-hidden, tighter padding, space for bottom nav
- KPI tiles: smaller type on phone, min-w-0
- html/body/#root: max-w 100vw overflow-x hidden

## 2. AI settings (Система → ИИ)
- Provider fixed: DeepSeek only
- Models: deepseek-chat | deepseek-reasoner
- API key saved in SQLite `app_settings` (server-only; UI shows masked hint)
- GET/PUT `/api/admin/ai/settings`
- Real calls when enabled + key; otherwise clear 503 messages
- Defaults: base https://api.deepseek.com, model deepseek-chat

## Deploy
1. Apply archive, push
2. Mac mini: pull, build, restart
3. Admin → Ещё → Система → ИИ → enable, paste DeepSeek key, Save
4. Помощник should work without .env AI_* (optional env still works as fallback)

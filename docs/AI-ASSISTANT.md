# AI-помощник админки

- Флаг: `AI_ASSISTANT=1`
- Ключ: `AI_API_KEY` (только server `.env`)
- Опционально: `AI_BASE_URL`, `AI_MODEL`
- Роли: owner и manager; viewer — 403
- Эндпоинты: `/api/admin/ai/catalog-advice`, `content-draft`, `anomaly-explain`, `shift-summary`
- Без ключа — mock-текст; **автопубликации нет**

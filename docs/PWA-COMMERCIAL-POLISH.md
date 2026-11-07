# PWA commercial polish
База архива уже: QR-first, токены Tailwind, reduced-motion, CMS content, игра в «Ещё».
Добавлено: tokens.ts, copy/ru, StateBlock, /legal, GET /api/public/content, POST /api/analytics/events, migration 018, PUSH_ENABLED, вибрация opt-in, manifest shortcuts.
Legal без деплоя: ключи app_settings legal_loyalty, legal_privacy, seller_info, home_banner, install_hint.
Push: таблица push_subscriptions; отправка только при заданных VAPID-ключах, флага PUSH_ENABLED в коде нет (см. docs/PUSH.md).

-- 046: push «заказ готов» — досыпаем поля к существующей таблице подписок.
--
-- Таблица `push_subscriptions` создана раньше (018_analytics_push_content):
--   id, endpoint UNIQUE, p256dh, auth, user_id, created_at, updated_at
-- Здесь добавляем то, что нужно для транзакционных пушей заказа.
-- VAPID-ключи живут в ENV (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT).

ALTER TABLE push_subscriptions ADD COLUMN user_agent TEXT;
ALTER TABLE push_subscriptions ADD COLUMN last_sent_at INTEGER;
ALTER TABLE push_subscriptions ADD COLUMN failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE push_subscriptions ADD COLUMN revoked_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id, revoked_at);

-- Отметки «уже отправили»: пуш уходит ровно один раз на заказ, даже если статус читают часто.
ALTER TABLE preorders ADD COLUMN push_ready_at INTEGER;
ALTER TABLE preorders ADD COLUMN push_paid_at INTEGER;

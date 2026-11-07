-- Откат 046: служебные поля подписок. Саму таблицу не трогаем — она из 018.
ALTER TABLE preorders DROP COLUMN push_paid_at;
ALTER TABLE preorders DROP COLUMN push_ready_at;
DROP INDEX IF EXISTS idx_push_user;
ALTER TABLE push_subscriptions DROP COLUMN revoked_at;
ALTER TABLE push_subscriptions DROP COLUMN failures;
ALTER TABLE push_subscriptions DROP COLUMN last_sent_at;
ALTER TABLE push_subscriptions DROP COLUMN user_agent;

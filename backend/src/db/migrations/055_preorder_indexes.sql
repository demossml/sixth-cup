-- 055: индексы предзаказов под реальные запросы (P2-2).
--
-- Горячие выборки: «мой активный заказ» по гостю, лента заказов точки по времени,
-- позиции/добавки по заказу, проверка бана по времени. Без индексов это full scan на каждый poll.
CREATE INDEX IF NOT EXISTS idx_preorders_guest_status ON preorders(guest_user_id, status);
CREATE INDEX IF NOT EXISTS idx_preorders_created ON preorders(created_at);
CREATE INDEX IF NOT EXISTS idx_preorders_status_expires ON preorders(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_preorder_items_order ON preorder_items(order_id);
CREATE INDEX IF NOT EXISTS idx_preorder_item_modifiers_item ON preorder_item_modifiers(order_item_id);
CREATE INDEX IF NOT EXISTS idx_preorder_bans_until ON preorder_bans(until);

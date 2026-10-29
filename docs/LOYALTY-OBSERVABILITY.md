# Что смотреть после выкладки ваучеров

Только чтение. Время: `disputes.created_at` — **миллисекунды** (`Date.now()`), `loyalty_reservations.created_at` — **секунды** (`Math.floor(Date.now()/1000)`).

```sql
-- Споры по ваучерам за 48 часов (ожидание: voucher_double_use ≈ 0)
SELECT kind, COUNT(*) FROM disputes
WHERE kind IN ('voucher_invalid','voucher_double_use','benefit_conflict')
  AND created_at > (strftime('%s','now') - 172800) * 1000 GROUP BY kind;

-- Сколько ваучеров погашено на кассе
SELECT COUNT(*) FROM loyalty_ops WHERE kind='SELL' AND voucher IS NOT NULL;

-- Выдано / использовано по шаблонам
SELECT template_id, COUNT(*) issued, SUM(used_at IS NOT NULL) used FROM vouchers GROUP BY template_id;

-- Резервы за 7 дней по статусам
SELECT status, COUNT(*) FROM loyalty_reservations WHERE created_at > strftime('%s','now','-7 day') GROUP BY status;

-- Подарок: напитки без галочки подарка
SELECT COUNT(*) total, SUM(counts_as_cup) cups, SUM(free_eligible) gift,
       SUM(CASE WHEN counts_as_cup=1 AND free_eligible=0 THEN 1 ELSE 0 END) cups_without_gift
FROM products WHERE available=1 AND COALESCE(is_group,0)=0;

-- Урезания льгот
SELECT created_at, details FROM disputes WHERE kind='loyalty_claim_clamped' ORDER BY id DESC LIMIT 50;
```

Массовое включение подарка у существующих напитков: админка → Товары → выбрать позиции → массовые действия → поле подарка (`/products/bulk`, `freeEligible`). SQL-скриптов нет (решение владельца D-03).

Если `cups_without_gift > 0`, касса не предложит подарок на эти позиции: включите галочку «Можно выдать бесплатно по лояльности» массовым действием.

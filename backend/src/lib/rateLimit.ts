import { db } from '../db'

/**
 * Общий счётчик запросов в окне (таблица rate_limits).
 * Возвращает true, если запрос разрешён; false — лимит исчерпан (вызывающий отдаёт 429).
 */
export function allowRequest(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const row = db.prepare('SELECT count, window_start FROM rate_limits WHERE key=?')
    .get(key) as { count: number; window_start: number } | undefined
  if (!row || now - row.window_start > windowMs) {
    db.prepare('INSERT OR REPLACE INTO rate_limits(key, count, window_start) VALUES(?,?,?)').run(key, 1, now)
    return true
  }
  if (row.count >= max) return false
  db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key=?').run(key)
  return true
}

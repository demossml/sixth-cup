/**
 * Статус данных карты. Различаем:
 *  - offline — нет сети (QR всё равно показан);
 *  - stale   — сеть есть, но давно не обновлялось;
 *  - fresh   — актуально; never — синхронизации ещё не было.
 * Никаких локальных начислений: время — только момент последнего ответа сервера.
 */
export type SyncKind = 'syncing' | 'offline' | 'stale' | 'fresh' | 'never'
export const STALE_MS = 5 * 60_000

export function fmtClock(ts: number, now = Date.now()): string {
  const d = new Date(ts)
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const sameDay = new Date(now).toDateString() === d.toDateString()
  return sameDay ? hm : `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}, ${hm}`
}

export function syncStatus(o: { online: boolean; syncing: boolean; lastSync: number; now?: number }): {
  kind: SyncKind
  label: string
  detail: string
} {
  const now = o.now ?? Date.now()
  const at = o.lastSync > 0 ? fmtClock(o.lastSync, now) : ''
  if (o.syncing) return { kind: 'syncing', label: 'Обновляем…', detail: at ? `Данные на ${at}` : '' }
  if (!o.online) return { kind: 'offline', label: 'Нет сети', detail: at ? `QR работает · данные на ${at}` : 'QR работает без сети' }
  if (o.lastSync <= 0) return { kind: 'never', label: 'Не обновлялось', detail: '' }
  if (now - o.lastSync >= STALE_MS) return { kind: 'stale', label: 'Давно не обновлялось', detail: `Данные на ${at}` }
  return { kind: 'fresh', label: `Обновлено ${at}`, detail: '' }
}

const SESSION_KEY = 'sc_analytics_sid'
function sessionId(): string {
  try {
    let s = sessionStorage.getItem(SESSION_KEY)
    if (!s) { s = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; sessionStorage.setItem(SESSION_KEY, s) }
    return s
  } catch { return 'anon' }
}
export function track(event: string, meta?: Record<string, string | number | boolean>) {
  try {
    // Офлайн событие всё равно не дойдёт, а в консоли останется ошибка сети
    // (ERR_INTERNET_DISCONNECTED / ERR_NAME_NOT_RESOLVED) — аудит PWA 15.11.2026.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    const body = JSON.stringify({ event, ts: Date.now(), sessionId: sessionId(), meta: meta ?? {} })
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon('/api/analytics/events', new Blob([body], { type: 'application/json' }))
      return
    }
    void fetch('/api/analytics/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
  } catch { /* аналитика не должна ломать экран */ }
}

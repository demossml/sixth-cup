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
    const body = JSON.stringify({ event, ts: Date.now(), sessionId: sessionId(), meta: meta ?? {} })
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon('/api/analytics/events', new Blob([body], { type: 'application/json' }))
      return
    }
    void fetch('/api/analytics/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true })
  } catch { /* ignore */ }
}

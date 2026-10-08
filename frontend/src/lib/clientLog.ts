/**
 * Reports client-side errors / important events to the backend (`POST /api/client-logs`),
 * where they show up in the admin "Логи" tab as source «Клиент».
 *
 * Privacy: only the message, the route *pathname* (no query string / hash — the URL may carry an
 * invite code) and a short user-agent are sent. Never pass tokens, QR payloads or JWTs here;
 * the backend redacts token-like strings as a second line of defence.
 */
type Level = 'error' | 'warn' | 'info'

const MAX_PER_SESSION = 30
const MAX_MESSAGE = 500
let sent = 0
const seen = new Set<string>()

function post(body: unknown) {
  try {
    void fetch('/api/client-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* logging must never break the app */
  }
}

export function clientLog(level: Level, message: string, meta?: Record<string, string | number | boolean>) {
  try {
    const msg = String(message).slice(0, MAX_MESSAGE)
    const key = `${level}:${msg}`
    if (sent >= MAX_PER_SESSION || seen.has(key)) return // dedupe + per-session cap
    seen.add(key)
    sent++
    post({
      level,
      message: msg,
      meta: { page: location.pathname, ua: navigator.userAgent.slice(0, 80), ...meta },
    })
  } catch {
    /* ignore */
  }
}

let installed = false

/** Capture uncaught errors and unhandled promise rejections. Call once at startup. */
export function installClientLog() {
  if (installed) return
  installed = true
  window.addEventListener('error', (e) => {
    const where = e.filename ? ` @ ${e.filename.split('/').pop()}:${e.lineno}` : ''
    clientLog('error', `${e.message || 'error'}${where}`)
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { message?: string } | undefined
    clientLog('error', `unhandledrejection: ${r?.message ?? String(e.reason)}`)
  })
}

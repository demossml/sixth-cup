/**
 * In-memory ring buffer of recent log lines for the admin "Логи" tab.
 * Optionally mirrors every line to LOG_PATH (append-only file).
 *
 * Line format: `ISO-time [source] [level] message`
 *   source: server | client | device
 *   level:  error | warn | info
 *
 * Everything that enters the buffer goes through `redact()` first, so secrets
 * (admin token, JWT, Evotor tokens, signed card QR tokens, Bearer headers)
 * never reach the buffer, the file or the admin UI.
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export type LogSource = 'server' | 'client' | 'device'
export type LogLevel = 'error' | 'warn' | 'info'

export const LOG_SOURCES: readonly LogSource[] = ['server', 'client', 'device']
export const LOG_LEVELS: readonly LogLevel[] = ['error', 'warn', 'info']

/** Per-source caps: a flood of client events can never push server lines out of memory. */
export const LOG_BUFFER_CAPS: Record<LogSource, number> = { server: 3000, client: 1000, device: 1000 }
export const LOG_MAX_LINES_RESPONSE = 500
const MAX_MESSAGE = 1000

type Entry = { seq: number; source: LogSource; level: LogLevel; line: string }
const buffers: Record<LogSource, Entry[]> = { server: [], client: [], device: [] }
let seq = 0

/* ───────────────────────────── redaction ───────────────────────────── */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Exact secret values taken from env at call time (cheap: a handful of strings). */
function secretValues(): string[] {
  const keys = ['ADMIN_TOKEN', 'JWT_SECRET', 'EVOTOR_PROXY_TOKEN', 'EVOTOR_API_TOKEN', 'EVOTOR_WEBHOOK_TOKEN']
  const out: string[] = []
  for (const k of keys) {
    const v = process.env[k]
    if (v && v.length >= 6) out.push(v)
  }
  return out
}

export function redact(input: string): string {
  let s = input
  for (const v of secretValues()) {
    if (s.includes(v)) s = s.split(v).join('[secret]')
  }
  // Authorization / token headers and "token=..." style pairs
  s = s.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, '$1 [redacted]')
  s = s.replace(
    /\b(x-admin-token|x-device-token|x-authorization|authorization|cookie|password|passwd|secret|token|jwt|api[_-]?key)(["']?\s*[:=]\s*["']?)[^\s"',;&}]+/gi,
    '$1$2[redacted]',
  )
  // JWT-like (three base64url parts)
  s = s.replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, '[jwt]')
  // Signed server tokens `payload.signature` (card QR) and any long opaque blob
  s = s.replace(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_.-]{16,}/g, '[token]')
  s = s.replace(/[A-Za-z0-9_-]{32,}/g, (m) => (UUID_RE.test(m) ? m : '[token]'))
  return s
}

/** Card code → `••42` (last two digits only). Anything non-string/empty → `••`. */
export function maskCode(code: unknown): string {
  const s = String(code ?? '').replace(/\s+/g, '')
  if (!s) return '••'
  if (s.startsWith('••') && s.length <= 4) return s // already masked (idempotent)
  // a signed QR token is not a short code — never echo any part of it
  if (s.includes('.') || s.length > 12) return '[token]'
  return '••' + s.slice(-2)
}

/** Short, non-reversible-enough prefix for ids (store/device uuid, reservation id). */
export function shortId(id: unknown, n = 4): string {
  const s = String(id ?? '')
  return s ? s.slice(0, n) : '-'
}

const SENSITIVE_KEY = /token|secret|password|passwd|authorization|cookie|jwt|signature|\bqr\b|payload|proof/i
const CARD_KEY = /^(code|card|cardcode|card_code)$/i

/** Flatten meta into `k=v k2=v2` with secrets dropped and card codes masked. */
export function formatMeta(meta: unknown, maxLen = 400): string {
  if (meta == null || typeof meta !== 'object') return ''
  const parts: string[] = []
  let i = 0
  for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
    if (i++ >= 20) break
    const key = k.replace(/[^\w.-]/g, '').slice(0, 32)
    if (!key) continue
    let val: string
    if (SENSITIVE_KEY.test(key)) val = '[redacted]'
    else if (CARD_KEY.test(key)) val = maskCode(v)
    else if (v == null) val = 'null'
    else if (typeof v === 'object') {
      try {
        val = JSON.stringify(v)
      } catch {
        val = '[obj]'
      }
    } else val = String(v)
    parts.push(`${key}=${val.slice(0, 120)}`)
  }
  return parts.join(' ').slice(0, maxLen)
}

/** One physical line: no CR/LF, no control chars (prevents log-line forging by clients). */
function oneLine(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\r\n\u2028\u2029]+/g, ' ⏎ ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
}

/* ───────────────────────────── writing ───────────────────────────── */

function mirrorToFile(line: string) {
  const logPath = process.env.LOG_PATH
  if (!logPath) return
  try {
    const full = resolve(logPath)
    mkdirSync(dirname(full), { recursive: true })
    appendFileSync(full, line + '\n', 'utf8')
  } catch {
    /* never let logging break the app */
  }
}

export function writeLog(source: LogSource, level: LogLevel, message: string, meta?: unknown): string {
  const metaStr = meta === undefined ? '' : formatMeta(meta)
  const text = oneLine(redact(String(message))).slice(0, MAX_MESSAGE)
  const msg = metaStr ? `${text} ${oneLine(redact(metaStr))}` : text
  const line = `${new Date().toISOString()} [${source}] [${level}] ${msg}`
  const buf = buffers[source]
  buf.push({ seq: ++seq, source, level, line })
  if (buf.length > LOG_BUFFER_CAPS[source]) buf.splice(0, buf.length - LOG_BUFFER_CAPS[source])
  mirrorToFile(line)
  return line
}

/** Server-side convenience wrappers. */
export const log = {
  info: (message: string, meta?: unknown) => writeLog('server', 'info', message, meta),
  warn: (message: string, meta?: unknown) => writeLog('server', 'warn', message, meta),
  error: (message: string, meta?: unknown) => writeLog('server', 'error', message, meta),
}

/** @deprecated kept for older call sites: `logLine('INFO', msg)` → server info. */
export function logLine(level: string, message: string, extra?: unknown): string {
  const l = level.toLowerCase()
  const lvl: LogLevel = l === 'error' ? 'error' : l === 'warn' || l === 'warning' ? 'warn' : 'info'
  return writeLog('server', lvl, message, typeof extra === 'object' ? extra : undefined)
}

/* ───────────────────────────── reading ───────────────────────────── */

export function queryLogs(opts: { lines: number; source?: LogSource | 'all'; level?: LogLevel | 'all' }) {
  const count = Math.min(Math.max(1, Math.floor(opts.lines) || 50), LOG_MAX_LINES_RESPONSE)
  const src = opts.source ?? 'all'
  const lvl = opts.level ?? 'all'
  const pools = src === 'all' ? LOG_SOURCES.map((k) => buffers[k]) : [buffers[src]]
  const matched = pools
    .flat()
    .filter((e) => lvl === 'all' || e.level === lvl)
    .sort((a, b) => a.seq - b.seq)
  return {
    lines: matched.slice(-count).map((e) => e.line),
    available: matched.length,
    total: bufferSize(),
  }
}

export function bufferSize(): number {
  return buffers.server.length + buffers.client.length + buffers.device.length
}

/** Test helper. */
export function _clearLogBuffer() {
  for (const k of LOG_SOURCES) buffers[k].length = 0
}

/* ───────────────────────────── process hooks ───────────────────────────── */

let consoleInstalled = false

/** Mirror console.* of the server into the buffer. Hono's own `logger()` lines are skipped (we log HTTP ourselves). */
export function installConsoleCapture() {
  if (consoleInstalled) return
  consoleInstalled = true
  const wrap =
    (level: LogLevel, orig: (...a: unknown[]) => void) =>
    (...args: unknown[]) => {
      try {
        const msg = args
          .map((a) => {
            if (typeof a === 'string') return a
            if (a instanceof Error) return a.stack?.split('\n').slice(0, 3).join(' | ') ?? a.message
            try {
              return JSON.stringify(a)
            } catch {
              return String(a)
            }
          })
          .join(' ')
        if (!/^(<--|-->) /.test(msg)) writeLog('server', level, msg)
      } catch {
        /* ignore */
      }
      orig(...args)
    }
  console.log = wrap('info', console.log.bind(console))
  console.info = wrap('info', console.info.bind(console))
  console.warn = wrap('warn', console.warn.bind(console))
  console.error = wrap('error', console.error.bind(console))
}

let processHooksInstalled = false

/** Record uncaught errors, then keep Node's default behaviour (exit 1) so the supervisor restarts us. */
export function installProcessErrorHooks() {
  if (processHooksInstalled) return
  processHooksInstalled = true
  process.on('uncaughtException', (err) => {
    writeLog('server', 'error', `uncaughtException: ${err?.stack?.split('\n').slice(0, 4).join(' | ') ?? String(err)}`)
    process.exit(1)
  })
  process.on('unhandledRejection', (reason) => {
    const r = reason as Error | undefined
    writeLog('server', 'error', `unhandledRejection: ${r?.stack?.split('\n').slice(0, 4).join(' | ') ?? String(reason)}`)
    process.exit(1)
  })
}

import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { writeLog, type LogSource } from '../../lib/logBuffer'
import { bad } from '../../lib/errors'

/* ───────────── in-memory fixed-window rate limiter (log ingestion only) ───────────── */

type Win = { count: number; start: number }
const windows = new Map<string, Win>()
let lastSweep = 0

/** Returns true when the call is allowed. */
export function allowLogIngest(key: string, max: number, windowMs = 60_000, now = Date.now()): boolean {
  if (now - lastSweep > windowMs) {
    lastSweep = now
    for (const [k, w] of windows) if (now - w.start > windowMs * 2) windows.delete(k)
    // hard cap on tracked keys so a spray of spoofed IPs cannot grow memory
    if (windows.size > 5000) windows.clear()
  }
  const w = windows.get(key)
  if (!w || now - w.start > windowMs) {
    windows.set(key, { count: 1, start: now })
    return true
  }
  if (w.count >= max) return false
  w.count++
  return true
}

export function _resetLogRateLimits() {
  windows.clear()
}

/* ───────────── shared payload shape ───────────── */

export const levelZ = z.enum(['error', 'warn', 'info'])

export const entryZ = z.object({
  level: levelZ.default('info'),
  message: z.string().min(1).max(2000),
  meta: z.record(z.unknown()).optional(),
})

/** Write validated entries; message is truncated here, and redaction/masking happens in writeLog. */
export function ingest(source: LogSource, entries: z.infer<typeof entryZ>[], tag?: string) {
  for (const e of entries) {
    const msg = e.message.slice(0, 500)
    writeLog(source, e.level, tag ? `${tag} ${msg}` : msg, e.meta)
  }
}

function clientIp(xff: string | undefined, real: string | undefined): string {
  return (xff?.split(',')[0] ?? real ?? 'unknown').trim().slice(0, 64) || 'unknown'
}

const PER_IP_PER_MIN = 30
const GLOBAL_PER_MIN = 300

/**
 * POST /api/client-logs — PWA reports errors / important events.
 * Public (guests have no JWT yet) so it is strictly bounded: 8 KB body, 30 req/min per IP,
 * 300/min overall, message ≤ 500 chars, ≤ 10 entries per request. The `source` is always "client".
 */
export const clientLogRoutes = new Hono().post(
  '/',
  bodyLimit({ maxSize: 8 * 1024, onError: (c) => c.json({ error: 'payload_too_large' }, 413) }),
  zValidator(
    'json',
    z.union([
      z.object({ entries: z.array(entryZ).min(1).max(10) }),
      // `source` is accepted for API symmetry but ignored: clients cannot impersonate server/device lines
      entryZ.extend({ source: z.string().max(16).optional() }),
    ]),
  ),
  (c) => {
    const ip = clientIp(c.req.header('x-forwarded-for'), c.req.header('x-real-ip'))
    if (!allowLogIngest(`client:${ip}`, PER_IP_PER_MIN) || !allowLogIngest('client:*', GLOBAL_PER_MIN)) {
      throw bad('Too many requests', 429)
    }
    const body = c.req.valid('json')
    ingest('client', 'entries' in body ? body.entries : [body])
    return c.json({ ok: true })
  },
)

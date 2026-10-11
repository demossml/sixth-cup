/**
 * Admin audit trail: every mutating call under /api/admin leaves one row in admin_audit.
 * Written by a single middleware, so old and new handlers are covered without touching them.
 * The shared admin token is the only identity today, so `actor` is "admin" (what and when, not who).
 * Tokens, secrets and Authorization headers never reach the table; request bodies are redacted and truncated.
 */
import { createMiddleware } from 'hono/factory'
import { db } from '../../db'

db.exec(`
  CREATE TABLE IF NOT EXISTS admin_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    actor TEXT NOT NULL DEFAULT 'admin',
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status INTEGER NOT NULL,
    ok INTEGER NOT NULL DEFAULT 1,
    entity TEXT,
    entity_id TEXT,
    summary TEXT,
    before_json TEXT,
    after_json TEXT,
    ip TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_admin_audit_at ON admin_audit(at);
  CREATE INDEX IF NOT EXISTS idx_admin_audit_entity ON admin_audit(entity, entity_id);
`)

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const SECRET_KEY = /token|secret|password|authorization|hash/i
const MAX_JSON = 4000

/** Path → entity ("/products/12/sync" → products, 12). Pure, covered by tests. */
export function entityFromPath(path: string): { entity: string | null; entityId: string | null } {
  const rest = path.replace(/^\/api\/admin\/?/, '').split('?')[0]
  const seg = rest.split('/').filter(Boolean)
  if (!seg.length) return { entity: null, entityId: null }
  if (seg[0] === 'evotor' && seg[1] === 'stores' && seg[2]) return { entity: 'evotor_store', entityId: seg[2] }
  if (seg[0] === 'evotor') return { entity: 'evotor', entityId: seg[1] ?? null }
  return { entity: seg[0], entityId: seg[1] && seg[1] !== 'bulk' ? seg[1] : null }
}

/** Remove secret-looking keys and cut the JSON to a safe size. */
export function redactJson(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const walk = (v: unknown, depth: number): unknown => {
    if (depth > 4) return '…'
    if (Array.isArray(v)) return v.slice(0, 50).map((x) => walk(x, depth + 1))
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = SECRET_KEY.test(k) ? '[скрыто]' : walk(x, depth + 1)
      return out
    }
    return v
  }
  const text = JSON.stringify(walk(value, 0))
  return text.length > MAX_JSON ? text.slice(0, MAX_JSON) + '…' : text
}

export type AuditInput = {
  method: string
  path: string
  status: number
  entity?: string | null
  entityId?: string | null
  summary?: string | null
  before?: unknown
  after?: unknown
  ip?: string | null
}

export function writeAudit(a: AuditInput) {
  const auto = entityFromPath(a.path)
  db.prepare(
    `INSERT INTO admin_audit(at,actor,method,path,status,ok,entity,entity_id,summary,before_json,after_json,ip)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    Date.now(), 'admin', a.method, a.path.slice(0, 200), a.status, a.status < 400 ? 1 : 0,
    a.entity ?? auto.entity, a.entityId ?? auto.entityId, a.summary?.slice(0, 300) ?? null,
    redactJson(a.before), redactJson(a.after), a.ip ?? null,
  )
}

/** Handlers may attach richer before/after/summary: c.set('audit', {...}). Otherwise the (redacted) request body is stored as `after`. */
export const auditMiddleware = createMiddleware<{ Variables: { audit?: Partial<AuditInput> } }>(async (c, next) => {
  const method = c.req.method
  if (!MUTATING.has(method)) return next()
  let body: unknown
  const ct = c.req.header('content-type') ?? ''
  if (ct.includes('application/json')) {
    try {
      body = JSON.parse(await c.req.raw.clone().text())
    } catch {
      body = undefined
    }
  }
  await next()
  try {
    const extra = c.get('audit') ?? {}
    const fwd = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null
    writeAudit({
      method,
      path: c.req.path,
      status: c.res.status,
      after: extra.after !== undefined ? extra.after : body,
      before: extra.before,
      summary: extra.summary,
      entity: extra.entity,
      entityId: extra.entityId,
      ip: fwd,
    })
  } catch (e) {
    console.error('[audit] write failed', String(e).slice(0, 200))
  }
})

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Контракт admin-клиент ↔ backend: каждый путь, который вызывает админка,
 * обязан иметь обработчик. Обратная проверка (route без клиента) — режим strict,
 * включается только CONTRACT_STRICT=1: 39 существующих orphan-эндпоинтов
 * перечислены в KNOWN_ORPHAN_SERVER и не должны ломать обычный прогон.
 */
const REPO = join(__dirname, '../../..')
const ADMIN_SRC = join(REPO, 'frontend-admin/src')
const BACKEND_SRC = join(REPO, 'backend/src')

/** Монтирования из backend/src/app.ts — префикс зависит от файла роутера. */
const MOUNTS: [string, string][] = [
  ['backend/src/modules/admin/', '/api/admin'],
  ['backend/src/modules/upload/routes.ts', '/api/admin/upload'],
  ['backend/src/modules/devices/routes.ts', '/api/devices'],
  ['backend/src/modules/staff/deviceRoutes.ts', '/api/devices'],
  ['backend/src/modules/staff/adminRoutes.ts', '/api/admin'],
  ['backend/src/modules/auth/routes.ts', '/api/auth'],
  ['backend/src/modules/loyalty/cardLookup.ts', '/api/loyalty'],
  ['backend/src/modules/directory/routes.ts', '/api/directory'],
  ['backend/src/modules/sync/routes.ts', '/api/sync'],
  ['backend/src/modules/game/routes.ts', '/api/game'],
  ['backend/src/modules/game/runner.ts', '/api/game/runner'],
  ['backend/src/modules/public/routes.ts', '/api/public'],
  ['backend/src/modules/analytics/routes.ts', '/api/analytics'],
  ['backend/src/modules/logs/routes.ts', '/api/client-logs'],
  ['backend/src/modules/dev/routes.ts', '/api/dev'],
]

/**
 * Снимок эндпоинтов, у которых сегодня нет прямого клиента в админке
 * (часть вызывается косвенно — через переменные путей и download()-хелперы).
 * Используется только в strict-режиме, чтобы зафиксировать состояние и заметить новые дыры.
 */
const KNOWN_ORPHAN_SERVER = [
  '/api/admin/ai/anomaly-explain',
  '/api/admin/ai/catalog-advice',
  '/api/admin/ai/content-draft',
  '/api/admin/ai/shift-summary',
  '/api/admin/analytics/affinity',
  '/api/admin/analytics/by-store',
  '/api/admin/analytics/compare',
  '/api/admin/analytics/customers',
  '/api/admin/analytics/heatmap',
  '/api/admin/analytics/overview',
  '/api/admin/analytics/staff',
  '/api/admin/analytics/window',
  '/api/admin/cashback/:userId',
  '/api/admin/devices',
  '/api/admin/devices/:id',
  '/api/admin/devices/:id/revoke',
  '/api/admin/disputes',
  '/api/admin/evotor/stores/:storeUuid/products',
  '/api/admin/inventory/:id',
  '/api/admin/inventory/:id/meta',
  '/api/admin/inventory/:id/sheet',
  '/api/admin/inventory/overview',
  '/api/admin/logs',
  '/api/admin/loyalty/ops',
  '/api/admin/me',
  '/api/admin/operations.csv',
  '/api/admin/operations/:store/:doc',
  '/api/admin/organizations',
  '/api/admin/organizations/:id',
  '/api/admin/overview',
  '/api/admin/products.csv',
  '/api/admin/products/:id/sync',
  '/api/admin/purchases/invoices/:id',
  '/api/admin/purchases/invoices/:id/receive',
  '/api/admin/purchases/snapshot',
  '/api/admin/referrals',
  '/api/admin/referrals/pairs',
  '/api/admin/sales/summary',
  '/api/admin/stock/consumption',
  '/api/admin/stock/items/:id',
  '/api/admin/stock/snapshot',
  '/api/admin/stores',
  '/api/admin/stores/:id',
  '/api/admin/suppliers/:id',
  '/api/admin/suppliers/:id/legal',
  '/api/admin/upload',
]

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/**
 * Путь из шаблона клиента: без query, каждый `${…}` → `:x`.
 * Хвост после `${` в сегменте отбрасывается — так `'/dashboard${qs({…})}'` даёт `/dashboard`,
 * а `'/customers/${id}'` даёт `/customers/:x`.
 */
export function normalizeClientPath(raw: string): string {
  const segments = raw.split('?')[0].split('/').map((seg) => {
    const cut = seg.indexOf('${')
    if (cut < 0) return seg
    return cut === 0 ? ':x' : seg.slice(0, cut)
  })
  return segments.join('/').replace(/\/+$/, '')
}

/**
 * Совпадение по сегментам: параметр backend (`:id`), сегмент клиента из шаблона (`:x`)
 * и настоящий литерал сравниваются как «любое значение».
 */
export function pathMatches(routePath: string, clientPath: string): boolean {
  const r = routePath.split('/').filter(Boolean)
  const c = clientPath.split('/').filter(Boolean)
  if (r.length !== c.length) return false
  return r.every((seg, i) => seg.startsWith(':') || c[i].startsWith(':') || seg === c[i])
}

type Decl = { method: string; path: string; file: string; line: number }

function scanRoutes(files: string[], mounts: [string, string][]): Decl[] {
  const out: Decl[] = []
  for (const file of files) {
    const rel = relative(REPO, file).split('\\').join('/')
    if (rel.includes('__tests__')) continue
    const prefix = mounts.find(([dir]) => rel.startsWith(dir))?.[1] ?? ''
    const text = readFileSync(file, 'utf8')
    const rx = /\.(get|post|patch|put|delete)\(\s*\n?\s*'([^']+)'/g
    let m: RegExpExecArray | null
    while ((m = rx.exec(text))) {
      if (!m[2].startsWith('/')) continue
      out.push({
        method: m[1].toUpperCase(),
        path: prefix + (m[2] === '/' ? '' : m[2]),
        file: rel,
        line: text.slice(0, m.index).split('\n').length,
      })
    }
  }
  return out
}

function scanClientCalls(files: string[]): { path: string; file: string; line: number }[] {
  const out: { path: string; file: string; line: number }[] = []
  for (const file of files) {
    const rel = relative(REPO, file).split('\\').join('/')
    if (rel.endsWith('.test.ts') || rel.endsWith('.test.tsx')) continue
    const text = readFileSync(file, 'utf8')
    const rx = /\b(?:api|useApi)(?:<[^>]*>)?\(\s*[`'"]([^`'"]+)/g
    let m: RegExpExecArray | null
    while ((m = rx.exec(text))) {
      const p = normalizeClientPath(m[1])
      if (!p.startsWith('/')) continue
      out.push({ path: `/api/admin${p}`, file: rel, line: text.slice(0, m.index).split('\n').length })
    }
  }
  return out
}

const serverRoutes = scanRoutes(walk(BACKEND_SRC), MOUNTS)
const clientCalls = scanClientCalls(walk(ADMIN_SRC))

describe('admin client ↔ backend contract', () => {
  it('scans a sane number of routes and calls', () => {
    expect(serverRoutes.length).toBeGreaterThan(150)
    expect(clientCalls.length).toBeGreaterThan(50)
  })

  it('every admin call has a backend handler', () => {
    const missing = clientCalls
      .filter((call) => !serverRoutes.some((route) => pathMatches(route.path, call.path)))
      .map((call) => `${call.file}:${call.line} → ${call.path}`)
    expect([...new Set(missing)]).toEqual([])
  })

  it('client calls only target /api/admin', () => {
    const wrong = clientCalls.filter((c) => !c.path.startsWith('/api/admin')).map((c) => `${c.file}:${c.line} → ${c.path}`)
    expect([...new Set(wrong)]).toEqual([])
  })

  it('strict mode: no new orphan admin routes (CONTRACT_STRICT=1)', () => {
    if (process.env.CONTRACT_STRICT !== '1') return
    const orphans = serverRoutes
      .filter((route) => route.path.startsWith('/api/admin'))
      .filter((route) => !clientCalls.some((call) => pathMatches(route.path, call.path)))
      .map((route) => route.path)
      .filter((p) => !KNOWN_ORPHAN_SERVER.some((known) => pathMatches(known, p)))
    expect([...new Set(orphans)]).toEqual([])
  })
})

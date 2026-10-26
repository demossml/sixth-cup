import { installConsoleCapture, redact, writeLog } from './lib/logBuffer'
installConsoleCapture()
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { HTTPException } from 'hono/http-exception'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { config } from './config'
import { adminRoutes } from './modules/admin/routes'
import { authRoutes } from './modules/auth/routes'
import { devRoutes } from './modules/dev/routes'
import { deviceRoutes } from './modules/devices/routes'
import { staffDeviceRoutes } from './modules/staff/deviceRoutes'
import { cardLookupRoutes } from './modules/loyalty/cardLookup'
import { directoryRoutes } from './modules/directory/routes'
import { syncRoutes } from './modules/sync/routes'
import { uploadRoutes } from './modules/upload/routes'
import { clientLogRoutes } from './modules/logs/routes'
import { gameRoutes } from './modules/game/routes'
import { runnerRoutes } from './modules/game/runner'
import { publicRoutes } from './modules/public/routes'
import { analyticsRoutes } from './modules/analytics/routes'

const app = new Hono()
/** Routes that already write their own, richer log lines (or are polled by the UI itself). */
function skipHttpLog(method: string, path: string): boolean {
  return (
    (method === 'GET' && path === '/api/admin/logs') ||
    (method === 'POST' && (path === '/api/client-logs' || path === '/api/devices/logs'))
  )
}

/** One line per /api/* request: method, path (no query string), status, duration. Never headers or bodies. */
app.use('/api/*', async (c, next) => {
  const start = Date.now()
  await next()
  const method = c.req.method
  const path = c.req.path
  if (method === 'OPTIONS' || skipHttpLog(method, path)) return
  const status = c.res.status
  let msg = `${method} ${path} ${status} ${Date.now() - start}ms`
  if (status >= 400) {
    try {
      if (c.res.headers.get('content-type')?.includes('application/json')) {
        const body = (await c.res.clone().json()) as { error?: unknown }
        if (typeof body?.error === 'string') msg += ` error="${body.error.slice(0, 120)}"`
      }
    } catch {
      /* body not readable — status is enough */
    }
  }
  writeLog('server', status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info', redact(msg))
})
app.use('*', logger())
app.use('/api/*', cors())

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
  console.error('[http] unhandled', c.req.method, c.req.path, err)
  return c.json({ error: 'Internal server error' }, 500)
})

/**
 * Версия сборки: чтобы после выкладки было видно, какой именно код работает.
 * Коммит берём из GIT_COMMIT (можно задать при деплое) или из .git рядом с проектом.
 */
function buildInfo() {
  let commit = process.env.GIT_COMMIT?.trim() || ''
  if (!commit) {
    try {
      commit = execSync('git rev-parse --short HEAD', { cwd: resolve(process.cwd(), '..'), stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim()
    } catch {
      commit = 'unknown'
    }
  }
  let version = ''
  try {
    version = String(JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')).version ?? '')
  } catch {
    version = ''
  }
  return { version, commit, startedAt: BUILD_STARTED_AT }
}

const BUILD_STARTED_AT = new Date().toISOString()

app.get('/health', (c) => c.json({ ok: true, ...buildInfo() }))

app.get('/uploads/:file', async (c) => {
  const file = c.req.param('file')
  if (!/^[a-zA-Z0-9._-]+$/.test(file)) return c.notFound()
  const path = join(config.uploadsDir, file)
  if (!existsSync(path)) return c.notFound()
  const ext = file.split('.').pop()?.toLowerCase()
  const type =
    ext === 'png' ? 'image/png'
    : ext === 'webp' ? 'image/webp'
    : ext === 'mp4' ? 'video/mp4'
    : ext === 'webm' ? 'video/webm'
    : 'image/jpeg'
  const size = statSync(path).size
  const cache = 'public, max-age=86400'
  const range = c.req.header('range')
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    if (!m) return c.text('Malformed Range', 416)
    let start = m[1] === '' ? 0 : Number(m[1])
    let end = m[2] === '' ? size - 1 : Number(m[2])
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' },
      })
    }
    if (end >= size) end = size - 1
    const data = readFileSync(path).subarray(start, end + 1)
    return new Response(data, {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Length': String(data.byteLength),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': cache,
      },
    })
  }
  const data = readFileSync(path)
  return new Response(data, {
    headers: {
      'Content-Type': type,
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': cache,
    },
  })
})

const routes = app
  .route('/api/auth', authRoutes)
  .route('/api/loyalty', cardLookupRoutes)
  .route('/api/directory', directoryRoutes)
  .route('/api/sync', syncRoutes)
  .route('/api/devices', deviceRoutes)
  .route('/api/devices', staffDeviceRoutes)
  .route('/api/dev', devRoutes)
  .route('/api/client-logs', clientLogRoutes)
  .route('/api/admin', adminRoutes)
  .route('/api/admin/upload', uploadRoutes)
  .route('/api/game', gameRoutes)
  .route('/api/game/runner', runnerRoutes)
  .route('/api/public', publicRoutes)
  .route('/api/analytics', analyticsRoutes)

export type AppType = typeof routes
export { app }
export default app

/** admin.example.com or ADMIN_HOST → admin SPA; else customer SPA */
function isAdminHost(host: string | undefined): boolean {
  if (!host) return false
  const h = host.split(':')[0].toLowerCase()
  if (config.adminHost && h === config.adminHost.toLowerCase()) return true
  if (h.startsWith('admin.')) return true
  if (h === 'admin.localhost' || h === 'localhost' && process.env.FORCE_ADMIN_UI === '1') return true
  return false
}

function distRoot(admin: boolean): string {
  // backend runs from backend/ ; dist siblings
  const base = resolve(process.cwd(), '..')
  return admin
    ? resolve(base, 'frontend-admin/dist')
    : resolve(base, 'frontend/dist')
}

if (!config.isDev) {
  // Customer static
  app.use('*', async (c, next) => {
    if (c.req.path.startsWith('/api') || c.req.path.startsWith('/uploads') || c.req.path === '/health') {
      return next()
    }
    const admin = isAdminHost(c.req.header('host'))
    const root = distRoot(admin)
    const rel = c.req.path === '/' ? 'index.html' : c.req.path.replace(/^\//, '')
    const candidate = join(root, rel)
    if (existsSync(candidate) && rel.includes('.')) {
      const data = readFileSync(candidate)
      const ext = rel.split('.').pop()?.toLowerCase()
      const types: Record<string, string> = {
        html: 'text/html; charset=utf-8',
        js: 'application/javascript',
        css: 'text/css',
        svg: 'image/svg+xml',
        png: 'image/png',
        ico: 'image/x-icon',
        webmanifest: 'application/manifest+json',
        woff2: 'font/woff2',
        woff: 'font/woff',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
        mp4: 'video/mp4',
        webm: 'video/webm',
      }
      const isHashedAsset =
        rel.startsWith('assets/') || /-[a-f0-9]{8,}\.[a-z0-9]+$/i.test(rel.split('/').pop() || '')
      const cache =
        ext === 'html' ? 'no-cache'
        : isHashedAsset ? 'public, max-age=31536000, immutable'
        : 'public, max-age=86400'
      return new Response(data, {
        headers: {
          'Content-Type': types[ext ?? ''] ?? 'application/octet-stream',
          'Cache-Control': cache,
        },
      })
    }
    // SPA fallback: только для маршрутов без расширения — иначе запрос удалённого файла
    // (например /classic.html от старой админки) вернул бы страницу приложения с кодом 200
    if (/\.[a-z0-9]+$/i.test(rel)) return c.text('Not found', 404)
    const index = join(root, 'index.html')
    if (existsSync(index)) {
      return new Response(readFileSync(index, 'utf8'), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
        },
      })
    }
    return c.text(`Frontend not built: ${root}`, 500)
  })
}

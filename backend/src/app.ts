import { installConsoleCapture, logLine } from './lib/logBuffer'
installConsoleCapture()
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { HTTPException } from 'hono/http-exception'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { config } from './config'
import { adminRoutes } from './modules/admin/routes'
import { authRoutes } from './modules/auth/routes'
import { devRoutes } from './modules/dev/routes'
import { deviceRoutes } from './modules/devices/routes'
import { cardLookupRoutes } from './modules/loyalty/cardLookup'
import { directoryRoutes } from './modules/directory/routes'
import { syncRoutes } from './modules/sync/routes'
import { uploadRoutes } from './modules/upload/routes'

const app = new Hono()
app.use('*', async (c, next) => {
  const start = Date.now()
  await next()
  if (c.req.path.startsWith('/api')) {
    logLine('HTTP', `${c.req.method} ${c.req.path} → ${c.res.status} ${Date.now() - start}ms`)
  }
})
app.use('*', logger())
app.use('/api/*', cors())

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

app.get('/health', (c) => c.json({ ok: true }))

app.get('/uploads/:file', async (c) => {
  const file = c.req.param('file')
  if (!/^[a-zA-Z0-9._-]+$/.test(file)) return c.notFound()
  const path = join(config.uploadsDir, file)
  if (!existsSync(path)) return c.notFound()
  const ext = file.split('.').pop()?.toLowerCase()
  const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
  const data = readFileSync(path)
  return new Response(data, {
    headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' },
  })
})

const routes = app
  .route('/api/auth', authRoutes)
  .route('/api/loyalty', cardLookupRoutes)
  .route('/api/directory', directoryRoutes)
  .route('/api/sync', syncRoutes)
  .route('/api/devices', deviceRoutes)
  .route('/api/dev', devRoutes)
  .route('/api/admin', adminRoutes)
  .route('/api/admin/upload', uploadRoutes)

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
  app.use('*', async (c, next) => {
    const path = c.req.path
    if (path.startsWith('/api') || path.startsWith('/uploads') || path === '/health') {
      return next()
    }
    const admin = isAdminHost(c.req.header('host'))
    const root = distRoot(admin)
    const filePath = path === '/' ? '/index.html' : path
    const full = join(root, filePath)
    if (existsSync(full) && !full.endsWith('/')) {
      // let serveStatic handle via rewrite — fallback index
    }
    await next()
  })

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
      }
      return new Response(data, { headers: { 'Content-Type': types[ext ?? ''] ?? 'application/octet-stream' } })
    }
    // SPA fallback
    const index = join(root, 'index.html')
    if (existsSync(index)) {
      return c.html(readFileSync(index, 'utf8'))
    }
    return c.text(`Frontend not built: ${root}`, 500)
  })
}

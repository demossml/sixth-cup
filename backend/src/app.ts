import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { HTTPException } from 'hono/http-exception'
import { serveStatic } from '@hono/node-server/serve-static'
import { config } from './config'
import { adminRoutes } from './modules/admin/routes'
import { authRoutes } from './modules/auth/routes'
import { devRoutes } from './modules/dev/routes'
import { deviceRoutes } from './modules/devices/routes'
import { directoryRoutes } from './modules/directory/routes'
import { syncRoutes } from './modules/sync/routes'

const app = new Hono()
app.use('*', logger())
app.use('/api/*', cors())

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

app.get('/health', (c) => c.json({ ok: true }))

const routes = app
  .route('/api/auth', authRoutes)
  .route('/api/directory', directoryRoutes)
  .route('/api/sync', syncRoutes)
  .route('/api/devices', deviceRoutes)
  .route('/api/dev', devRoutes)
  .route('/api/admin', adminRoutes)

export type AppType = typeof routes
export { app }
export default app

if (!config.isDev) {
  app.use('/*', serveStatic({ root: '../frontend/dist' }))
  app.get('*', serveStatic({ path: '../frontend/dist/index.html' }))
}

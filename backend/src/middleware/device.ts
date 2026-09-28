import { createHash } from 'node:crypto'
import { createMiddleware } from 'hono/factory'
import { db } from '../db'
import { bad } from '../lib/errors'

export type DeviceEnv = { Variables: { deviceId: number; storeId: number } }

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex')

export const requireDevice = createMiddleware<DeviceEnv>(async (c, next) => {
  const token = c.req.header('X-Device-Token')
  if (!token) throw bad('Unauthorized', 401)
  const d = db.prepare('SELECT id, store_id, revoked FROM devices WHERE token_hash=?')
    .get(hashToken(token)) as { id: number; store_id: number; revoked: number } | undefined
  if (!d || d.revoked) throw bad('Invalid device', 401)
  c.set('deviceId', d.id)
  c.set('storeId', d.store_id)
  await next()
})

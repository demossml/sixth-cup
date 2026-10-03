import { createMiddleware } from 'hono/factory'
import { verify } from 'hono/jwt'
import { config } from '../config'
import { db } from '../db'
import { bad } from '../lib/errors'

export type AuthEnv = { Variables: { userId: number } }

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const header = c.req.header('Authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined
  if (!token) throw bad('Unauthorized', 401)
  try {
    const payload = await verify(token, config.jwtSecret, 'HS256')
    const userId = Number(payload.sub)
    if (!Number.isFinite(userId) || userId <= 0) throw bad('Invalid token', 401)
    const exists = db.prepare('SELECT 1 AS ok FROM users WHERE id=?').get(userId) as { ok: number } | undefined
    if (!exists) throw bad('Invalid token', 401)
    c.set('userId', userId)
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) throw e
    throw bad('Invalid token', 401)
  }
  await next()
})

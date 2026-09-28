import { createMiddleware } from 'hono/factory'
import { verify } from 'hono/jwt'
import { config } from '../config'
import { bad } from '../lib/errors'

export type AuthEnv = { Variables: { userId: number } }

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const header = c.req.header('Authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined
  if (!token) throw bad('Unauthorized', 401)
  try {
    const payload = await verify(token, config.jwtSecret, 'HS256')
    c.set('userId', Number(payload.sub))
  } catch {
    throw bad('Invalid token', 401)
  }
  await next()
})

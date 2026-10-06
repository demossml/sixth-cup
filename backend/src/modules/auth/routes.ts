import { Hono } from 'hono'
import { sign } from 'hono/jwt'
import { config } from '../../config'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { createGuestUser } from './service'

async function jwtFor(userId: number) {
  return sign(
    { sub: userId, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 180 },
    config.jwtSecret,
  )
}

function hitRate(key: string, max: number, windowMs: number) {
  const now = Date.now()
  const row = db.prepare('SELECT count, window_start FROM rate_limits WHERE key=?')
    .get(key) as { count: number; window_start: number } | undefined
  if (!row || now - row.window_start > windowMs) {
    db.prepare('INSERT OR REPLACE INTO rate_limits(key, count, window_start) VALUES(?,?,?)').run(key, 1, now)
    return
  }
  if (row.count >= max) throw bad('Слишком много запросов. Попробуйте позже.', 429)
  db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key=?').run(key)
}

export const authRoutes = new Hono()
  .post('/guest', async (c) => {
    const raw = (await c.req.json().catch(() => ({}))) as { inviteCode?: string }
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      || c.req.header('x-real-ip')
      || 'unknown'
    hitRate(`guest-ip:${ip}`, 30, 60 * 60_000)
    const invite = typeof raw.inviteCode === 'string' && raw.inviteCode.trim()
      ? raw.inviteCode.trim()
      : undefined
    const userId = createGuestUser(invite)
    return c.json({ token: await jwtFor(userId), resumed: false })
  })

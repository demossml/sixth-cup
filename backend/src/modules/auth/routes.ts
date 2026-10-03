import { createHash } from 'node:crypto'
import { Hono } from 'hono'
import { sign } from 'hono/jwt'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { config } from '../../config'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { createGuestUser, sendCode, verifyCodeAndLogin } from './service'

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
    db.prepare('INSERT OR REPLACE INTO rate_limits(key, count, window_start) VALUES(?,?,?)')
      .run(key, 1, now)
    return
  }
  if (row.count >= max) throw bad('Слишком много запросов. Попробуйте позже.', 429)
  db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key=?').run(key)
}

export const authRoutes = new Hono()
  .post('/guest', async (c) => {
    const raw = (await c.req.json().catch(() => ({}))) as {
      inviteCode?: string
      clientNonce?: string
    }
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      || c.req.header('x-real-ip')
      || 'unknown'
    hitRate(`guest-ip:${ip}`, 30, 60 * 60_000)

    const invite = typeof raw.inviteCode === 'string' && raw.inviteCode.trim()
      ? raw.inviteCode.trim()
      : undefined
    const nonce = typeof raw.clientNonce === 'string' && raw.clientNonce.length >= 8
      ? raw.clientNonce.slice(0, 64)
      : undefined

    if (nonce) {
      const idempKey = `guest-idemp:${createHash('sha256').update(nonce + config.jwtSecret).digest('hex')}`
      const existing = db.prepare('SELECT count, window_start FROM rate_limits WHERE key=?')
        .get(idempKey) as { count: number; window_start: number } | undefined
      const now = Date.now()
      if (existing && now - existing.window_start < 10 * 60_000 && existing.count > 0) {
        const userId = existing.count
        if (db.prepare('SELECT id FROM users WHERE id=?').get(userId)) {
          return c.json({ token: await jwtFor(userId), resumed: true })
        }
      }
      const userId = createGuestUser(invite)
      db.prepare('INSERT OR REPLACE INTO rate_limits(key, count, window_start) VALUES(?,?,?)')
        .run(idempKey, userId, now)
      return c.json({ token: await jwtFor(userId), resumed: false })
    }

    const userId = createGuestUser(invite)
    return c.json({ token: await jwtFor(userId), resumed: false })
  })
  .post('/send-code', zValidator('json', z.object({ phone: z.string().min(10).max(20) })), async (c) => {
    if (!config.isDev) throw bad('Вход по телефону отключён', 404)
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'unknown'
    const { devCode } = await sendCode(c.req.valid('json').phone, ip)
    return c.json({ ok: true, ...(devCode ? { devCode } : {}) })
  })
  .post(
    '/verify',
    zValidator('json', z.object({
      phone: z.string().min(10).max(20),
      code: z.string().min(4).max(8),
      inviteCode: z.string().optional(),
    })),
    async (c) => {
      if (!config.isDev) throw bad('Вход по телефону отключён', 404)
      const userId = verifyCodeAndLogin(c.req.valid('json'))
      return c.json({ token: await jwtFor(userId) })
    },
  )

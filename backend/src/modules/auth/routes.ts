import { Hono } from 'hono'
import { sign } from 'hono/jwt'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { config } from '../../config'
import { createGuestUser, sendCode, verifyCodeAndLogin } from './service'

async function jwtFor(userId: number) {
  return sign(
    { sub: userId, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 180 },
    config.jwtSecret,
  )
}

export const authRoutes = new Hono()
  /** Выдача карты без телефона / SMS / ПДн. */
  .post('/guest', async (c) => {
    const raw = (await c.req.json().catch(() => ({}))) as { inviteCode?: string }
    const invite = typeof raw.inviteCode === 'string' && raw.inviteCode.trim()
      ? raw.inviteCode.trim()
      : undefined
    const userId = createGuestUser(invite)
    const token = await jwtFor(userId)
    return c.json({ token })
  })
  /** @deprecated не используется клиентом */
  .post('/send-code', zValidator('json', z.object({ phone: z.string().min(10).max(20) })), async (c) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'unknown'
    const { devCode } = await sendCode(c.req.valid('json').phone, ip)
    return c.json({ ok: true, ...(devCode ? { devCode } : {}) })
  })
  /** @deprecated */
  .post(
    '/verify',
    zValidator('json', z.object({
      phone: z.string().min(10).max(20),
      code: z.string().min(4).max(8),
      inviteCode: z.string().optional(),
    })),
    async (c) => {
      const userId = verifyCodeAndLogin(c.req.valid('json'))
      const token = await jwtFor(userId)
      return c.json({ token })
    },
  )

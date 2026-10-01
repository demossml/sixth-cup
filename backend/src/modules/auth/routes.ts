import { Hono } from 'hono'
import { sign } from 'hono/jwt'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { config } from '../../config'
import { requireAuth, type AuthEnv } from '../../middleware/auth'
import { consumeRecoveryToken, createRecoveryToken } from './recovery'
import { registerAnonymousUser, sendCode, verifyCodeAndLogin } from './service'

const phone = z.string().min(10).max(20)
const tokenPayload = (userId: number) => ({
  sub: userId,
  exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 180,
})

export const authRoutes = new Hono<AuthEnv>()
  .post('/guest', zValidator('json', z.object({ inviteCode: z.string().trim().min(1).max(32).optional() })), async (c) => {
    const { inviteCode } = c.req.valid('json')
    const userId = registerAnonymousUser(inviteCode)
    const token = await sign(tokenPayload(userId), config.jwtSecret)
    return c.json({ token, userId })
  })
  .post('/send-code', zValidator('json', z.object({ phone })), async (c) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'unknown'
    const { devCode } = await sendCode(c.req.valid('json').phone, ip)
    return c.json({ ok: true, ...(devCode ? { devCode } : {}) })
  })
  .post('/verify',
    zValidator('json', z.object({
      phone,
      code: z.string().min(4).max(8),
      inviteCode: z.string().optional(),
    })),
    async (c) => {
      const userId = verifyCodeAndLogin(c.req.valid('json'))
      const token = await sign(tokenPayload(userId), config.jwtSecret)
      return c.json({ token })
    })
  .post('/recovery/create', requireAuth, async (c) => {
    const userId = c.get('userId')
    const token = createRecoveryToken(userId)
    return c.json({ token })
  })
  .post('/recovery/use', zValidator('json', z.object({ token: z.string().min(20).max(256) })), async (c) => {
    const userId = consumeRecoveryToken(c.req.valid('json').token)
    const token = await sign(tokenPayload(userId), config.jwtSecret)
    return c.json({ token, userId })
  })

import { Hono } from 'hono'
import { sign } from 'hono/jwt'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { config } from '../../config'
import { sendCode, verifyCodeAndLogin } from './service'

const phone = z.string().min(10).max(20)

export const authRoutes = new Hono()
  .post('/send-code', zValidator('json', z.object({ phone })), async (c) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'unknown'
    try {
      const { devCode } = await sendCode(c.req.valid('json').phone, ip)
      return c.json({ ok: true, ...(devCode ? { devCode } : {}) })
    } catch (e) {
      throw e
    }
  })
  .post('/verify',
    zValidator('json', z.object({
      phone,
      code: z.string().min(4).max(8),
      inviteCode: z.string().optional(),
    })),
    async (c) => {
      const userId = verifyCodeAndLogin(c.req.valid('json'))
      const token = await sign(
        { sub: userId, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 180 },
        config.jwtSecret,
      )
      return c.json({ token })
    })

import { Hono } from 'hono'
import { sign } from 'hono/jwt'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { config } from '../../config'
import { sendCode, verifyCodeAndLogin } from './service'

const phone = z.string().regex(/^\+?\d{10,15}$/, 'Телефон: 10–15 цифр')

export const authRoutes = new Hono()
  .post('/send-code', zValidator('json', z.object({ phone })), (c) => {
    const code = sendCode(c.req.valid('json').phone)
    return c.json({ ok: true, devCode: config.isDev ? code : undefined })
  })
  .post('/verify',
    zValidator('json', z.object({ phone, code: z.string().length(4), inviteCode: z.string().optional() })),
    async (c) => {
      const userId = verifyCodeAndLogin(c.req.valid('json'))
      const token = await sign({ sub: userId, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 180 }, config.jwtSecret)
      return c.json({ token })
    })

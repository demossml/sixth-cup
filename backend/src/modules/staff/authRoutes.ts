/**
 * Вход сотрудников: POST /api/staff/login, GET /api/staff/me.
 *
 * Монтируется под `/api/staff` — отдельно от `/api/auth` (гости) и `/api/admin` (ADMIN_TOKEN):
 * у сотрудника своя сессия, но админ-токен продолжает работать как break-glass.
 */
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { allowRequest } from '../../lib/rateLimit'
import { clientIpKey } from '../../lib/clientIp'
import { bad } from '../../lib/errors'
import { log } from '../../lib/logBuffer'
import { requireStaff, signStaffToken, type StaffEnv } from '../../middleware/staffAuth'
import { burnPasswordCheck, verifyPassword } from './password'
import { findAppUserByLogin, toPublicUser } from './appUsers'

const loginBodyLimit = bodyLimit({
  maxSize: 4 * 1024,
  onError: (c) => c.json({ error: 'payload_too_large' }, 413),
})

const loginSchema = z.object({
  login: z.string().min(1).max(80),
  password: z.string().min(1).max(200),
})

export const staffAuthRoutes = new Hono<StaffEnv>()
  .post('/login', loginBodyLimit, zValidator('json', loginSchema), async (c) => {
    const { login, password } = c.req.valid('json')
    // Перебор пароля: лимит по логину (не зависит от IP) и, если IP известен, по IP.
    if (!allowRequest(`staff-login:${login.trim().toLowerCase()}`, 10, 15 * 60_000)) {
      throw bad('Слишком много попыток. Попробуйте позже.', 429)
    }
    const ipKey = clientIpKey(c, 'staff-login-ip')
    if (ipKey && !allowRequest(ipKey, 60, 15 * 60_000)) {
      throw bad('Слишком много попыток. Попробуйте позже.', 429)
    }

    const user = findAppUserByLogin(login)
    if (!user) {
      await burnPasswordCheck(password)
      log.warn('staff login failed', { login: login.slice(0, 40), reason: 'unknown' })
      throw bad('Неверный логин или пароль', 401)
    }
    if (!(await verifyPassword(password, user.password_hash))) {
      log.warn('staff login failed', { user: user.id, reason: 'password' })
      throw bad('Неверный логин или пароль', 401)
    }
    // Пароль верный, но доступ закрыт — отдельным статусом, чтобы UI написал «обратитесь к администратору».
    if (user.active !== 1) {
      log.warn('staff login failed', { user: user.id, reason: 'inactive' })
      throw bad('Сотрудник отключён', 403)
    }

    log.info('staff login', { user: user.id, role: user.role })
    return c.json({
      token: await signStaffToken(user),
      role: user.role,
      storeUuid: user.store_uuid,
      alertBlink: user.alert_blink === 1,
      displayName: user.display_name,
      login: user.login,
    })
  })

  .get('/me', requireStaff(), (c) => {
    const staff = c.get('staff')
    const row = findAppUserByLogin(staff.login)
    if (!row) throw bad('Unauthorized', 401)
    return c.json({ user: toPublicUser(row) })
  })

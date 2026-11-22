/**
 * Admin CRUD пользователей приложения: /api/admin/app-users.
 *
 * Авторизация — существующая админская (ADMIN_TOKEN, роли owner/manager/viewer) через
 * middleware в `modules/admin/routes.ts`; отдельного пароля администратора здесь нет.
 * Аудит пишется общим middleware админки (пароль в before/after маскируется по ключу).
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { bad } from '../../lib/errors'
import { APP_USER_ROLES, createAppUser, findAppUserById, listAppUsers, toPublicUser, updateAppUser } from './appUsers'

const roleSchema = z.enum(APP_USER_ROLES)

const passwordSchema = z.string().min(8, 'Пароль короче 8 символов').max(200)

const createSchema = z.object({
  login: z.string().min(3, 'Логин короче 3 символов').max(80),
  password: passwordSchema,
  role: roleSchema,
  storeUuid: z.string().max(80).nullish(),
  alertBlink: z.boolean().optional(),
  displayName: z.string().max(120).nullish(),
})

const patchSchema = z.object({
  login: z.string().min(3).max(80).optional(),
  password: passwordSchema.optional(),
  role: roleSchema.optional(),
  storeUuid: z.string().max(80).nullish(),
  active: z.boolean().optional(),
  alertBlink: z.boolean().optional(),
  displayName: z.string().max(120).nullish(),
})

export const appUsersAdmin = new Hono()
  .get('/app-users', (c) => {
    return c.json({ users: listAppUsers(), roles: [...APP_USER_ROLES] })
  })

  .post('/app-users', zValidator('json', createSchema), async (c) => {
    const user = await createAppUser(c.req.valid('json'))
    return c.json({ ok: true, user }, 201)
  })

  .patch('/app-users/:id', zValidator('json', patchSchema), async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id <= 0) throw bad('Некорректный id', 400)
    const patch = c.req.valid('json')
    if (!Object.keys(patch).length) throw bad('Нет полей для обновления', 400)
    const user = await updateAppUser(id, patch)
    return c.json({ ok: true, user })
  })

  .get('/app-users/:id', (c) => {
    const id = Number(c.req.param('id'))
    const row = Number.isInteger(id) ? findAppUserById(id) : null
    if (!row) throw bad('Пользователь не найден', 404)
    return c.json({ user: toPublicUser(row) })
  })

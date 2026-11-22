/**
 * Авторизация сотрудников по login/password.
 *
 * JWT в том же секрете, что у гостей (`JWT_SECRET`), но с отдельной меткой `typ: 'staff'`:
 *  • гостевой `requireAuth` отвергает токены с этой меткой — сотрудник не может «стать гостем»;
 *  • staff-токен не может быть принят как гостевой, даже если `sub` совпадёт с id гостя.
 *
 * В каждом запросе пользователь перечитывается из БД: деактивация и сброс пароля
 * (`token_version`) действуют сразу, без ожидания истечения токена.
 */
import { createMiddleware } from 'hono/factory'
import { sign, verify } from 'hono/jwt'
import { config } from '../config'
import { bad } from '../lib/errors'
import { findAppUserById, type AppUserRow, type StaffRole } from '../modules/staff/appUsers'

export type StaffClaims = {
  id: number
  login: string
  role: StaffRole
  storeUuid: string | null
}

export type StaffEnv = { Variables: { staff: StaffClaims } }

/** Смена бариста длиннее 12 часов не бывает; перелогин в тот же день дешевле вечных токенов. */
const STAFF_TOKEN_TTL_SEC = 12 * 60 * 60

export async function signStaffToken(user: AppUserRow): Promise<string> {
  return sign(
    {
      sub: String(user.id),
      typ: 'staff',
      role: user.role,
      store: user.store_uuid ?? null,
      ver: Number(user.token_version ?? 0),
      exp: Math.floor(Date.now() / 1000) + STAFF_TOKEN_TTL_SEC,
    },
    config.jwtSecret,
    'HS256',
  )
}

export function requireStaff(...allowed: StaffRole[]) {
  return createMiddleware<StaffEnv>(async (c, next) => {
    const header = c.req.header('Authorization')
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined
    if (!token) throw bad('Unauthorized', 401)
    let payload: Record<string, unknown>
    try {
      payload = (await verify(token, config.jwtSecret, 'HS256')) as Record<string, unknown>
    } catch {
      throw bad('Invalid token', 401)
    }
    if (payload.typ !== 'staff') throw bad('Invalid token', 401)
    const id = Number(payload.sub)
    if (!Number.isFinite(id) || id <= 0) throw bad('Invalid token', 401)
    const row = findAppUserById(id)
    if (!row) throw bad('Invalid token', 401)
    if (Number(payload.ver ?? -1) !== Number(row.token_version ?? 0)) throw bad('Invalid token', 401)
    if (row.active !== 1) throw bad('Сотрудник отключён', 403)
    if (allowed.length && !allowed.includes(row.role)) throw bad('Недостаточно прав', 403)
    c.set('staff', {
      id: row.id,
      login: row.login,
      role: row.role,
      storeUuid: row.store_uuid,
    })
    await next()
  })
}

/**
 * Учётные записи сотрудников приложения (`app_users`).
 *
 * Роли:
 *  • `owner` / `admin` — видят все точки, работают и в админке;
 *  • `barista` — только очередь своей точки (`store_uuid` обязателен).
 *
 * Здесь только доступ к данным и валидация; HTTP-слой — в `authRoutes.ts` и `appUsersAdmin.ts`.
 */
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { hashPassword, passwordPolicyIssues, verifyPassword } from './password'

export const APP_USER_ROLES = ['owner', 'admin', 'barista'] as const
export type StaffRole = (typeof APP_USER_ROLES)[number]

export type AppUserRow = {
  id: number
  login: string
  password_hash: string
  role: StaffRole
  store_uuid: string | null
  active: number
  alert_blink: number
  display_name: string | null
  token_version: number
  created_at: number
  updated_at: number
}

export type PublicAppUser = {
  id: number
  login: string
  role: StaffRole
  storeUuid: string | null
  active: boolean
  alertBlink: boolean
  displayName: string | null
  createdAt: number
  updatedAt: number
}

export function toPublicUser(row: AppUserRow): PublicAppUser {
  return {
    id: row.id,
    login: row.login,
    role: row.role,
    storeUuid: row.store_uuid,
    active: row.active === 1,
    alertBlink: row.alert_blink === 1,
    displayName: row.display_name,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export function normalizeLogin(login: string): string {
  return login.trim().slice(0, 80)
}

/** Логин сравнивается без учёта регистра: у колонки `login` COLLATE NOCASE. */
export function findAppUserByLogin(login: string): AppUserRow | null {
  const row = db.prepare('SELECT * FROM app_users WHERE login=?').get(normalizeLogin(login)) as AppUserRow | undefined
  return row ?? null
}

export function findAppUserById(id: number): AppUserRow | null {
  const row = db.prepare('SELECT * FROM app_users WHERE id=?').get(id) as AppUserRow | undefined
  return row ?? null
}

export function listAppUsers(): PublicAppUser[] {
  const rows = db.prepare('SELECT * FROM app_users ORDER BY active DESC, login').all() as AppUserRow[]
  return rows.map(toPublicUser)
}

/**
 * Точка бариста обязательна, у owner/admin — только `null` (все точки).
 * Возвращает нормализованное значение, чтобы «» и «  » не превращались в пустую точку.
 */
export function resolveStoreUuid(role: StaffRole, storeUuid: string | null | undefined): string | null {
  const value = (storeUuid ?? '').trim().slice(0, 80) || null
  if (role === 'barista') {
    if (!value) throw bad('Для роли «бариста» выберите точку', 400)
    return value
  }
  if (value) throw bad('Точка указывается только для роли «бариста»', 400)
  return null
}

export type CreateAppUserInput = {
  login: string
  password: string
  role: StaffRole
  storeUuid?: string | null
  alertBlink?: boolean
  displayName?: string | null
}

export async function createAppUser(input: CreateAppUserInput): Promise<PublicAppUser> {
  const login = normalizeLogin(input.login)
  if (login.length < 3) throw bad('Логин короче 3 символов', 400)
  const issues = passwordPolicyIssues(input.password)
  if (issues.length) throw bad(issues.join('. '), 400)
  const storeUuid = resolveStoreUuid(input.role, input.storeUuid)
  const passwordHash = await hashPassword(input.password)
  const now = Date.now()
  try {
    const r = db.prepare(`
      INSERT INTO app_users(login, password_hash, role, store_uuid, active, alert_blink, display_name, created_at, updated_at)
      VALUES(?,?,?,?,1,?,?,?,?)
    `).run(
      login,
      passwordHash,
      input.role,
      storeUuid,
      input.alertBlink === false ? 0 : 1,
      (input.displayName ?? '').trim().slice(0, 120) || null,
      now,
      now,
    )
    return toPublicUser(findAppUserById(Number(r.lastInsertRowid))!)
  } catch (e) {
    if (String((e as { code?: string }).code ?? '').startsWith('SQLITE_CONSTRAINT')) {
      throw bad('Пользователь с таким логином уже существует', 409)
    }
    throw e
  }
}

export type UpdateAppUserInput = {
  login?: string
  password?: string
  role?: StaffRole
  storeUuid?: string | null
  active?: boolean
  alertBlink?: boolean
  displayName?: string | null
}

export async function updateAppUser(id: number, patch: UpdateAppUserInput): Promise<PublicAppUser> {
  const current = findAppUserById(id)
  if (!current) throw bad('Пользователь не найден', 404)

  const role = patch.role ?? current.role
  // Смена роли на owner/admin без явной точки = «все точки»: иначе смена роли упиралась бы
  // в ошибку «точка только для бариста» из-за старого значения в записи.
  const storeInput =
    patch.storeUuid !== undefined
      ? patch.storeUuid
      : patch.role !== undefined && role !== 'barista'
        ? null
        : current.store_uuid
  const storeUuid = resolveStoreUuid(role, storeInput)
  const login = patch.login === undefined ? current.login : normalizeLogin(patch.login)
  if (login.length < 3) throw bad('Логин короче 3 символов', 400)

  let passwordHash = current.password_hash
  // Сброс пароля отзывает уже выданные токены: версия уходит вперёд, старые JWT перестают проверяться.
  let tokenVersion = current.token_version
  if (patch.password !== undefined) {
    const issues = passwordPolicyIssues(patch.password)
    if (issues.length) throw bad(issues.join('. '), 400)
    passwordHash = await hashPassword(patch.password)
    tokenVersion += 1
  }

  try {
    db.prepare(`
      UPDATE app_users
      SET login=?, password_hash=?, role=?, store_uuid=?, active=?, alert_blink=?, display_name=?,
          token_version=?, updated_at=?
      WHERE id=?
    `).run(
      login,
      passwordHash,
      role,
      storeUuid,
      patch.active === undefined ? current.active : patch.active ? 1 : 0,
      patch.alertBlink === undefined ? current.alert_blink : patch.alertBlink ? 1 : 0,
      patch.displayName === undefined
        ? current.display_name
        : (patch.displayName ?? '').trim().slice(0, 120) || null,
      tokenVersion,
      Date.now(),
      id,
    )
  } catch (e) {
    if (String((e as { code?: string }).code ?? '').startsWith('SQLITE_CONSTRAINT')) {
      throw bad('Пользователь с таким логином уже существует', 409)
    }
    throw e
  }
  return toPublicUser(findAppUserById(id)!)
}

/** Сохранение настройки моргания из интерфейса бариста. */
export function setAlertBlink(id: number, alertBlink: boolean): PublicAppUser {
  db.prepare('UPDATE app_users SET alert_blink=?, updated_at=? WHERE id=?').run(alertBlink ? 1 : 0, Date.now(), id)
  return toPublicUser(findAppUserById(id)!)
}

export { verifyPassword }

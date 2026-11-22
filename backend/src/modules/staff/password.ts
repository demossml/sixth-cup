/**
 * Пароли сотрудников: scrypt из `node:crypto`.
 *
 * Почему scrypt, а не argon2id/bcrypt: в проекте нет ни одной из этих библиотек, а тянуть
 * нативную зависимость ради одного модуля не нужно — scrypt входит в Node и остаётся
 * memory-hard KDF. Параметры пишутся в сам хэш, поэтому их можно поднять позже без миграции:
 *   `scrypt$<N>$<r>$<p>$<salt-b64url>$<key-b64url>`
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>

const ALGO = 'scrypt'
const N = 16384
const R = 8
const P = 1
const KEY_LEN = 32
const SALT_LEN = 16

export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 200

/** Пароль проверяем до хэширования: длинные строки только зря жгут CPU. */
export function passwordPolicyIssues(password: string): string[] {
  const issues: string[] = []
  if (password.length < MIN_PASSWORD_LENGTH) issues.push(`Пароль короче ${MIN_PASSWORD_LENGTH} символов`)
  if (password.length > MAX_PASSWORD_LENGTH) issues.push('Пароль слишком длинный')
  return issues
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN)
  const key = await scrypt(password.normalize('NFKC'), salt, KEY_LEN)
  return [ALGO, N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== ALGO) return false
  const [, nRaw, rRaw, pRaw, saltRaw, keyRaw] = parts
  const n = Number(nRaw)
  const r = Number(rRaw)
  const p = Number(pRaw)
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false
  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(saltRaw, 'base64url')
    expected = Buffer.from(keyRaw, 'base64url')
  } catch {
    return false
  }
  if (!salt.length || !expected.length) return false
  try {
    const key = await scrypt(password.normalize('NFKC'), salt, expected.length)
    return key.length === expected.length && timingSafeEqual(key, expected)
  } catch {
    return false
  }
}

/**
 * Хэш-пустышка для входа с несуществующим логином: сравнение с ним тратит то же время,
 * что и настоящая проверка, поэтому по задержке нельзя понять, есть ли такой логин.
 */
let dummyHash: string | null = null
export async function burnPasswordCheck(password: string): Promise<void> {
  if (!dummyHash) dummyHash = await hashPassword(randomBytes(24).toString('hex'))
  await verifyPassword(password, dummyHash)
}

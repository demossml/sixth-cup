import { Hono } from 'hono'
import { sign } from 'hono/jwt'
import { config } from '../../config'
import { clientIp } from '../../lib/clientIp'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { createHash, randomBytes } from 'node:crypto'
import { requireAuth, type AuthEnv } from '../../middleware/auth'
import { createGuestUser } from './service'

function tokenVersion(userId: number): number {
  const row = db.prepare('SELECT token_version AS v FROM users WHERE id=?').get(userId) as { v: number } | undefined
  return Number(row?.v ?? 0)
}

async function jwtFor(userId: number) {
  return sign(
    { sub: userId, ver: tokenVersion(userId), exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 180 },
    config.jwtSecret,
  )
}

function hitRate(key: string, max: number, windowMs: number) {
  const now = Date.now()
  const row = db.prepare('SELECT count, window_start FROM rate_limits WHERE key=?')
    .get(key) as { count: number; window_start: number } | undefined
  if (!row || now - row.window_start > windowMs) {
    db.prepare('INSERT OR REPLACE INTO rate_limits(key, count, window_start) VALUES(?,?,?)').run(key, 1, now)
    return
  }
  if (row.count >= max) throw bad('Слишком много запросов. Попробуйте позже.', 429)
  db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key=?').run(key)
}

const hashRecovery = (c: string) => createHash('sha256').update(c).digest('hex')

export const authRoutes = new Hono<AuthEnv>()
  .post('/guest', async (c) => {
    const raw = (await c.req.json().catch(() => ({}))) as { inviteCode?: string }
    // IP — только из доверенных заголовков (P1-2); без прокси лимит по IP не ставим.
    const ip = clientIp(c)
    if (ip) hitRate(`guest-ip:${ip}`, 30, 60 * 60_000)
    const invite = typeof raw.inviteCode === 'string' && raw.inviteCode.trim()
      ? raw.inviteCode.trim()
      : undefined
    const userId = createGuestUser(invite)
    return c.json({ token: await jwtFor(userId), resumed: false })
  })
  // Create (or rotate) the recovery secret. Shown once to the user as a QR/text; only its hash is stored.
  .post('/recovery', requireAuth, (c) => {
    // Лимит: код восстановления — чувствительная операция, не даём генерировать его пачками (P2-8).
    hitRate(`recovery-user:${c.get('userId')}`, 5, 60 * 60_000)
    const secret = randomBytes(24).toString('base64url')
    db.prepare('UPDATE users SET recovery_hash=? WHERE id=?').run(hashRecovery(secret), c.get('userId'))
    return c.json({ recovery: `sc1.${secret}` })
  })
  // Осознанный выход/сброс карты: отзывает все ранее выданные токены этого пользователя.
  .post('/revoke', requireAuth, (c) => {
    db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id=?').run(c.get('userId'))
    return c.json({ ok: true })
  })
  .post('/restore', async (c) => {
    const raw = (await c.req.json().catch(() => ({}))) as { recovery?: string }
    const ip = clientIp(c)
    if (ip) hitRate(`restore-ip:${ip}`, 10, 60 * 60_000)
    const code = typeof raw.recovery === 'string' ? raw.recovery.trim() : ''
    if (!code.startsWith('sc1.') || code.length > 100) throw bad('Неверный код восстановления', 400)
    const u = db.prepare('SELECT id FROM users WHERE recovery_hash=?').get(hashRecovery(code.slice(4))) as { id: number } | undefined
    if (!u) throw bad('Неверный код восстановления', 404)
    // Восстановление на новом устройстве отзывает токены прежнего (сценарий потери телефона).
    db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id=?').run(u.id)
    return c.json({ token: await jwtFor(u.id), resumed: true })
  })

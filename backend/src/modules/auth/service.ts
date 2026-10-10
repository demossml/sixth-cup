import { randomBytes } from 'node:crypto'
import { db } from '../../db'
import { bad } from '../../lib/errors'
import { ensureCard } from '../loyalty/proof'
import { log } from '../../lib/logBuffer'

function registerUser(inviteCode?: string): number {
  const invite = inviteCode?.trim() || null
  let invitedBy: number | null = null
  if (invite) {
    const inv = db.prepare('SELECT id FROM users WHERE invite_code=?').get(invite) as { id: number } | undefined
    if (!inv) throw bad('Неверный код приглашения', 400)
    invitedBy = inv.id
  }
  const t = Date.now()
  const nickname = `Гость ${Math.random().toString(36).slice(2, 8).toUpperCase()}`
  const inviteSelf = randomBytes(6).toString('base64url').slice(0, 10).toUpperCase()
  const phone = `guest:${randomBytes(16).toString('hex')}`
  const r = db.prepare(
    `INSERT INTO users(phone,nickname,invite_code,invited_by,created_at) VALUES(?,?,?,?,?)`,
  ).run(phone, nickname, inviteSelf, invitedBy, t)
  const userId = Number(r.lastInsertRowid)
  ensureCard(userId)
  // Diagnostics for "who invited whom": internal ids only (never the invite code, tokens or secrets).
  log.info('guest registered', { user: userId, invitedBy: invitedBy ?? '-', withInvite: invite ? 1 : 0 })
  return userId
}

/** Anonymous account. No phone number, SMS or PII is required. */
export function createGuestUser(inviteCode?: string): number {
  return registerUser(inviteCode)
}

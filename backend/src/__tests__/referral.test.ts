import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-ref-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { app } = await import('../app')
const { db } = await import('../db')
const { queryLogs } = await import('../lib/logBuffer')
// Pure client modules: no DOM needed, storage is injected.
const inv = await import('../../../frontend/src/lib/invite')
const { formatRub } = await import('../../../frontend/src/lib/money')
import type { KV } from '../../../frontend/src/lib/invite'

function memStore(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) }
}

async function register(inviteCode?: string) {
  const r = await app.request('/api/auth/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(inviteCode ? { inviteCode } : {}) })
  const body = await r.json() as { token?: string; error?: string }
  return { status: r.status, body }
}
const lastUser = () => db.prepare('SELECT id, card_code, invite_code, invited_by FROM users ORDER BY id DESC LIMIT 1').get() as { id: number; card_code: string | null; invite_code: string; invited_by: number | null }
const DAY = 24 * 3600 * 1000

describe('client invite store', () => {
  it('remembers a link only for a browser without an account, and always asks to strip the URL', () => {
    const s = memStore()
    expect(inv.captureInvite('?invite=ABCD1234EF', false, s, 1000)).toEqual({ strip: true, stored: true })
    expect(inv.getInvite(s, 2000)).toBe('ABCD1234EF')

    const existing = memStore()
    // existing account (JWT present): somebody's link must not be remembered for a later card
    expect(inv.captureInvite('?invite=ABCD1234EF', true, existing, 1000)).toEqual({ strip: true, stored: false })
    expect(inv.getInvite(existing, 2000)).toBeUndefined()

    expect(inv.captureInvite('?x=1', false, memStore())).toEqual({ strip: false, stored: false })
    expect(inv.captureInvite('?invite=<script>', false, memStore())).toEqual({ strip: true, stored: false })
  })

  it('expires, drops legacy bare strings, and is cleared after use', () => {
    const s = memStore()
    inv.captureInvite('?invite=ABCD1234EF', false, s, 0)
    expect(inv.getInvite(s, 13 * DAY)).toBe('ABCD1234EF')
    expect(inv.getInvite(s, 15 * DAY)).toBeUndefined()
    expect(s.data.has(inv.INVITE_KEY)).toBe(false) // expired entry removed

    s.setItem(inv.INVITE_KEY, 'ABCD1234EF') // value written by the old build
    expect(inv.getInvite(s, 1)).toBeUndefined()
    expect(s.data.has(inv.INVITE_KEY)).toBe(false)

    inv.captureInvite('?invite=ABCD1234EF', false, s, 5)
    inv.clearInvite(s)
    expect(inv.getInvite(s, 6)).toBeUndefined()
  })

  it('works without storage', () => {
    expect(inv.captureInvite('?invite=ABCD1234EF', false, null)).toEqual({ strip: true, stored: false })
    expect(inv.getInvite(null)).toBeUndefined()
    expect(() => inv.clearInvite(null)).not.toThrow()
  })
})

describe('referral binding on the server', () => {
  it('binds the friend to the inviter by invite_code → users.id (not to the card number)', async () => {
    await register() // user 1
    await register() // user 2
    const inviter = await register()
    const inviterRow = lastUser()
    expect(inviterRow.id).toBeGreaterThan(2)
    const friend = await register(inviterRow.invite_code)
    expect(friend.status).toBe(200)
    const friendRow = lastUser()
    expect(friendRow.invited_by).toBe(inviterRow.id)
    expect(inviter.body.token).toBeTruthy()
  })

  it('card number is NOT an invite code', async () => {
    const before = lastUser()
    const r = await register(String(before.card_code ?? before.id))
    expect(r.status).toBe(400)
    expect(inv.isInvalidInviteError(new Error(r.body.error))).toBe(true)
  })

  it('full client scenario: stale invite cannot reach the next card', async () => {
    const s = memStore()
    const inviterRow = (await register(), lastUser())

    // friend opens the link in a fresh browser → registers with it → invite is consumed
    inv.captureInvite(`?invite=${inviterRow.invite_code}`, false, s, 0)
    const first = await register(inv.getInvite(s, 1))
    expect(first.status).toBe(200)
    expect(lastUser().invited_by).toBe(inviterRow.id)
    inv.clearInvite(s) // what ensureGuest does after success

    // card reset: nothing must remain → new card has no referrer
    expect(inv.getInvite(s, 2)).toBeUndefined()
    await register(inv.getInvite(s, 2))
    expect(lastUser().invited_by).toBeNull()
  })

  it('an unknown code is dropped and registration succeeds without it (client retry path)', async () => {
    const bad = await register('NOSUCHCODE')
    expect(bad.status).toBe(400)
    const retry = await register(undefined)
    expect(retry.status).toBe(200)
    expect(lastUser().invited_by).toBeNull()
  })

  it('writes a diagnostic line with internal ids only', async () => {
    const inviterRow = (await register(), lastUser())
    await register(inviterRow.invite_code)
    const lines = queryLogs({ lines: 50, source: 'server' }).lines.join('\n')
    expect(lines).toMatch(new RegExp(`guest registered .*invitedBy=${inviterRow.id}`))
    expect(lines).not.toContain(inviterRow.invite_code)
  })

  it('/api/sync exposes referral cashback in kopecks (and keeps the rubles field)', async () => {
    const inviterRegistered = await register()
    const inviterRow = lastUser()
    await register(inviterRow.invite_code)
    const friendRow = lastUser()
    db.prepare('INSERT INTO cashback_ledger(beneficiary_id,from_user_id,receipt_id,amount,created_at) VALUES(?,?,?,?,?)').run(inviterRow.id, friendRow.id, 'r1', 450, Date.now())
    const r = await app.request('/api/sync', { method: 'POST', headers: { Authorization: `Bearer ${inviterRegistered.body.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ receipts: [] }) })
    const me = (await r.json() as any).me
    expect(me).toMatchObject({ fromFriendsKopecks: 450, fromFriendsRub: 4, friendsCount: 1 })
  })
})

describe('money formatting', () => {
  it('keeps kopecks', () => {
    expect(formatRub(450)).toBe('4,50')
    expect(formatRub(400)).toBe('4')
    expect(formatRub(5)).toBe('0,05')
    expect(formatRub(0)).toBe('0')
    expect(formatRub(undefined)).toBe('0')
    expect(formatRub(-10)).toBe('0')
    expect(formatRub(123456).replace(/\s/g, ' ')).toBe('1 234,56')
  })
})

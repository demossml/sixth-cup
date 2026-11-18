/**
 * B-01 + B-04 — гостевой `/api/sync`:
 *  • чек можно применить только его владельцу (receipt.u === JWT sub);
 *  • у синка есть частотный лимит (каждый чек — Ed25519 + запись в БД).
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ed25519 } from '@noble/curves/ed25519'

const dir = mkdtempSync(join(tmpdir(), 'sc-sync-owner-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { app } = await import('../app')
const { db } = await import('../db')
const { b64u } = await import('../lib/crypto')

const JSONH = { 'content-type': 'application/json' }

let seq = 0
let receiptQ = Math.floor(Date.now() / 1000)

async function newGuest(): Promise<{ token: string; userId: number }> {
  const r = await app.request('/api/auth/guest', { method: 'POST', headers: JSONH, body: '{}' })
  const { token } = (await r.json()) as { token: string }
  const row = db.prepare('SELECT MAX(id) AS id FROM users').get() as { id: number }
  return { token, userId: Number(row.id) }
}

function deviceWithKey(): { id: number; priv: Uint8Array } {
  const priv = ed25519.utils.randomPrivateKey()
  const pub = ed25519.getPublicKey(priv)
  db.prepare(`INSERT OR IGNORE INTO stores(id, name, address) VALUES(1,'Точка','Адрес')`).run()
  const info = db.prepare('INSERT INTO devices(store_id, name, public_key, revoked, created_at) VALUES(1,?,?,0,?)')
    .run(`sync-dev-${++seq}`, b64u.enc(pub), Date.now())
  return { id: Number(info.lastInsertRowid), priv }
}

function receiptFor(priv: Uint8Array, deviceId: number, userId: number, paidCups: number): string {
  const payload = {
    t: 'r',
    r: `${deviceId}-${++seq}`,
    u: userId,
    d: deviceId,
    q: (receiptQ += 2),
    p: paidCups,
    f: 0,
    v: [],
    cb: 0,
    dp: 0,
    df: 0,
    dcb: 0,
    vu: [],
    a: 0,
    ts: Math.floor(Date.now() / 1000),
  }
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  return `${b64u.enc(bytes)}.${b64u.enc(ed25519.sign(bytes, priv))}`
}

const postSync = (token: string, receipts: string[]) =>
  app.request('/api/sync', {
    method: 'POST', headers: { ...JSONH, Authorization: `Bearer ${token}` }, body: JSON.stringify({ receipts }),
  })

const paidTotal = (userId: number) =>
  Number((db.prepare('SELECT paid_total AS p FROM cards WHERE user_id=?').get(userId) as { p: number } | undefined)?.p ?? 0)

describe('B-04: чужой чек не применяется', () => {
  it('гость не может прокрутить чек другого гостя', async () => {
    const owner = await newGuest()
    const stranger = await newGuest()
    const dev = deviceWithKey()
    const token = receiptFor(dev.priv, dev.id, owner.userId, 3)

    const res = await postSync(stranger.token, [token])
    expect(res.status).toBe(200)
    const body = (await res.json()) as { result: { applied: string[]; rejected: Array<{ reason: string }> } }
    expect(body.result.applied).toHaveLength(0)
    expect(body.result.rejected.map((r) => r.reason)).toContain('receipt_belongs_to_another_user')
    // Ни владельцу, ни «прокрутившему» ничего не начислено.
    expect(paidTotal(owner.userId)).toBe(0)
    expect(paidTotal(stranger.userId)).toBe(0)
  })

  it('свой чек владелец применяет как раньше', async () => {
    const owner = await newGuest()
    const dev = deviceWithKey()
    const token = receiptFor(dev.priv, dev.id, owner.userId, 4)

    const res = await postSync(owner.token, [token])
    const body = (await res.json()) as { result: { applied: string[]; rejected: unknown[] } }
    expect(body.result.applied).toHaveLength(1)
    expect(body.result.rejected).toHaveLength(0)
  })
})

describe('B-01: лимит на гостевой синк', () => {
  it('двадцатый запрос в минуту ещё проходит, двадцать первый — 429', async () => {
    const g = await newGuest()
    for (let i = 0; i < 20; i += 1) {
      expect((await postSync(g.token, [])).status).toBe(200)
    }
    const limited = await postSync(g.token, [])
    expect(limited.status).toBe(429)
  })
})

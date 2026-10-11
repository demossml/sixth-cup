import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-history-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { app } = await import('../app')
const { db } = await import('../db')

describe('client sync history', () => {
  let token = ''
  let userId = 0
  let cardId = ''

  beforeAll(async () => {
    const registered = await app.request('/api/auth/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    expect(registered.status).toBe(200)
    const guest = await registered.json() as { token: string }
    token = guest.token
    const user = db.prepare('SELECT id, card_id FROM users ORDER BY id DESC LIMIT 1').get() as { id: number; card_id: string }
    userId = user.id
    cardId = user.card_id
  })

  it('does not duplicate a SELL cup delta with a loyalty_ledger progress row', async () => {
    const now = Date.now()
    db.prepare(`INSERT INTO loyalty_ops (doc_store, doc_id, kind, card_id, result_rub, cups_counted, created_at)
      VALUES (?, ?, 'SELL', ?, ?, ?, ?)`).run('history-test-store', 'history-test-sale', cardId, 150, 1, now)
    db.prepare(`INSERT INTO loyalty_ledger (card_id, operation, cups_delta, free_delta, cashback_delta, source_type, source_id, created_at)
      VALUES (?, 'EARN', 1, 0, 450, 'SELL', 'history-test-sale', ?)`).run(cardId, now)

    const response = await app.request('/api/sync/history?limit=50', { headers: { Authorization: `Bearer ${token}` } })
    expect(response.status).toBe(200)
    const body = await response.json() as { items: Array<{ id: string; cupsDelta: number; title: string; status: string }> }
    const saleItems = body.items.filter(item => item.cupsDelta === 1)
    expect(saleItems).toHaveLength(1)
    expect(saleItems[0].id).toBe('op:history-test-store:history-test-sale')
    expect(saleItems[0].status).toBe('confirmed')
  })

  it('returns only referral cashback for the authenticated beneficiary', async () => {
    db.prepare('INSERT INTO cashback_ledger (beneficiary_id, from_user_id, receipt_id, amount, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(userId, userId, 'history-test-referral', 250, Date.now())
    const response = await app.request('/api/sync/history?limit=1&cursor=0', { headers: { Authorization: `Bearer ${token}` } })
    expect(response.status).toBe(200)
    const body = await response.json() as { items: Array<{ kind: string; cashbackDeltaKop: number; status: string }> }
    expect(body.items.some(item => item.kind === 'referral' && item.cashbackDeltaKop === 250 && item.status === 'confirmed')).toBe(true)
  })
})

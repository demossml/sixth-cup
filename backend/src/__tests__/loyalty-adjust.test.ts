/**
 * 3.3: ручная корректировка балансов владельцем — с причиной, записью в loyalty_ledger
 * (operation='ADJUSTMENT') и аудитом old/new.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { app } from '../app'
import { db } from '../db'
import { config } from '../config'

const H = { 'X-Admin-Token': config.adminToken, 'content-type': 'application/json' }
const call = async (m: string, p: string, body?: unknown, headers: Record<string, string> = H) => {
  const r = await app.request(`/api/admin${p}`, {
    method: m,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any }
}

let seq = 0
async function guest(): Promise<number> {
  const r = await app.request('/api/auth/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  const { token } = (await r.json()) as { token: string }
  await app.request('/api/loyalty/card', { headers: { Authorization: `Bearer ${token}` } })
  const code = String(2100 + ++seq)
  db.prepare('UPDATE users SET card_code=? WHERE id=(SELECT MAX(id) FROM users)').run(code)
  return Number((db.prepare('SELECT MAX(id) AS id FROM users').get() as { id: number }).id)
}

const cardOf = (userId: number) =>
  db.prepare('SELECT paid_total AS paidTotal, free_used AS freeUsed FROM cards WHERE user_id=?').get(userId) as
    | { paidTotal: number; freeUsed: number }
    | undefined

const cashbackOf = (userId: number) =>
  Number((db.prepare('SELECT cashback_balance AS b FROM users WHERE id=?').get(userId) as { b: number }).b)

beforeAll(() => {
  db.prepare(`INSERT OR IGNORE INTO cards(user_id, updated_at) SELECT id, ? FROM users`).run(Date.now())
})

describe('3.3: POST /customers/:id/loyalty-adjust', () => {
  it('корректирует чашки, free_used и кэшбэк и пишет ledger', async () => {
    const id = await guest()
    const r = await call('POST', `/customers/${id}/loyalty-adjust`, {
      cupsDelta: 3,
      freeUsedDelta: 1,
      cashbackDeltaKop: 5000,
      reason: 'компенсация за сбой кассы',
    })
    expect(r.status).toBe(200)
    expect(r.json.card).toMatchObject({ paidTotal: 3, freeUsed: 1, cashback: 5000 })
    expect(cardOf(id)).toEqual({ paidTotal: 3, freeUsed: 1 })
    expect(cashbackOf(id)).toBe(5000)

    const cardId = (db.prepare('SELECT card_id AS c FROM users WHERE id=?').get(id) as { c: string }).c
    const ledger = db
      .prepare(`SELECT operation, cups_delta AS cups, free_delta AS free, cashback_delta AS cb, source_type AS src
                FROM loyalty_ledger WHERE card_id=?`)
      .all(cardId) as any[]
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({ operation: 'ADJUSTMENT', cups: 3, free: 1, cb: 5000, src: 'ADMIN_ADJUST' })
  })

  it('пишет аудит с причиной, старыми и новыми значениями', async () => {
    const id = await guest()
    await call('POST', `/customers/${id}/loyalty-adjust`, { cupsDelta: 2, reason: 'ручная выдача' })
    await call('POST', `/customers/${id}/loyalty-adjust`, { cupsDelta: -1, reason: 'исправление' })

    const rows = db
      .prepare(`SELECT summary, before_json AS before, after_json AS after FROM admin_audit
                WHERE entity='customers' AND entity_id=? ORDER BY id`)
      .all(String(id)) as { summary: string; before: string; after: string }[]
    expect(rows).toHaveLength(2)
    expect(rows[0].summary).toMatch(/ручная выдача/)
    expect(JSON.parse(rows[0].after)).toMatchObject({ reason: 'ручная выдача', paidTotal: 2 })
    expect(JSON.parse(rows[1].before)).toMatchObject({ paidTotal: 2 })
    expect(JSON.parse(rows[1].after)).toMatchObject({ paidTotal: 1 })
  })

  it('без reason → 400', async () => {
    const id = await guest()
    const r = await call('POST', `/customers/${id}/loyalty-adjust`, { cupsDelta: 1 })
    expect(r.status).toBe(400)
  })

  it('короткая причина и пустая корректировка → 400', async () => {
    const id = await guest()
    expect((await call('POST', `/customers/${id}/loyalty-adjust`, { cupsDelta: 1, reason: 'ok' })).status).toBe(400)
    expect(
      (await call('POST', `/customers/${id}/loyalty-adjust`, { reason: 'пустая корректировка' })).status,
    ).toBe(400)
  })

  it('неизвестный клиент → 404', async () => {
    const r = await call('POST', '/customers/999999/loyalty-adjust', { cupsDelta: 1, reason: 'проверка' })
    expect(r.status).toBe(404)
  })

  it('кламп в ноль: списание больше баланса не уводит в минус', async () => {
    const id = await guest()
    await call('POST', `/customers/${id}/loyalty-adjust`, { cupsDelta: 2, reason: 'стартовое начисление' })
    const r = await call('POST', `/customers/${id}/loyalty-adjust`, { cupsDelta: -10, reason: 'обнуление' })
    expect(r.status).toBe(200)
    expect(r.json.applied.cupsDelta).toBe(-2) // применилось только доступное
    expect(cardOf(id)?.paidTotal).toBe(0)

    const nothing = await call('POST', `/customers/${id}/loyalty-adjust`, { cupsDelta: -5, reason: 'ещё раз' })
    expect(nothing.status).toBe(400) // применять нечего
  })

  it('viewer не может корректировать', async () => {
    const id = await guest()
    const r = await call(
      'POST',
      `/customers/${id}/loyalty-adjust`,
      { cupsDelta: 1, reason: 'попытка' },
      { 'X-Admin-Token': 'not-an-owner-token', 'content-type': 'application/json' },
    )
    expect(r.status).toBe(403)
  })
})

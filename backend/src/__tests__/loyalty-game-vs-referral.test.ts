/**
 * 3.5: награда за игру не попадает в «кэшбэк от друзей» (карточка, /admin/referrals, история PWA),
 * а в истории показывается отдельной строкой «Награда за игру».
 */
import { describe, expect, it } from 'vitest'
import { app } from '../app'
import { db } from '../db'
import { config } from '../config'
import { friendsView } from '../modules/loyalty/cardLookup'

const H = { 'X-Admin-Token': config.adminToken, 'content-type': 'application/json' }

let seq = 0
async function guest(): Promise<{ jwt: string; userId: number; cardId: string }> {
  const r = await app.request('/api/auth/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  const { token } = (await r.json()) as { token: string }
  const c = await app.request('/api/loyalty/card', { headers: { Authorization: `Bearer ${token}` } })
  const card = (await c.json()) as { cardCode: string }
  const row = db.prepare('SELECT id, card_id AS cardId FROM users WHERE card_code=?').get(card.cardCode) as {
    id: number
    cardId: string
  }
  return { jwt: token, userId: row.id, cardId: row.cardId }
}

const addLedger = (beneficiary: number, from: number, receiptId: string, amount: number) =>
  db
    .prepare('INSERT INTO cashback_ledger(beneficiary_id, from_user_id, receipt_id, amount, created_at) VALUES(?,?,?,?,?)')
    .run(beneficiary, from, receiptId, amount, Date.now())

describe('3.5: игровой и реферальный кэшбэк', () => {
  it('friendsView не считает игровые награды', async () => {
    const g = await guest()
    const friend = await guest()
    addLedger(g.userId, friend.userId, 'rec-referral-1', 300)
    addLedger(g.userId, g.userId, `game:${++seq}`, 500)

    const view = friendsView(g.userId)
    expect(view.fromFriendsKopecks).toBe(300) // только реферальный
  })

  it('/admin/referrals не смешивает игру и рефералку', async () => {
    const inviter = await guest()
    const invited = await guest()
    db.prepare('UPDATE users SET invited_by=? WHERE id=?').run(inviter.userId, invited.userId)
    addLedger(inviter.userId, invited.userId, 'rec-referral-2', 400)
    addLedger(inviter.userId, inviter.userId, `game:${++seq}`, 700)

    const r = await app.request('/api/admin/referrals', { headers: H })
    const j = (await r.json()) as { referrers: any[] }
    const row = j.referrers.find((x) => x.referrerId === inviter.userId)
    expect(row.cashbackKop).toBe(400)
  })

  it('история PWA: игра отдельной строкой, рефералка своей', async () => {
    const g = await guest()
    const friend = await guest()
    addLedger(g.userId, friend.userId, 'rec-referral-3', 250)
    addLedger(g.userId, g.userId, `game:${++seq}`, 900)

    const r = await app.request('/api/sync/history?limit=30', { headers: { Authorization: `Bearer ${g.jwt}` } })
    const j = (await r.json()) as { items: { kind: string; title: string; cashbackDeltaKop: number }[] }

    const game = j.items.filter((i) => i.kind === 'game_reward')
    expect(game).toHaveLength(1)
    expect(game[0]).toMatchObject({ title: 'Награда за игру', cashbackDeltaKop: 900 })

    const referral = j.items.filter((i) => i.kind === 'referral')
    expect(referral).toHaveLength(1)
    expect(referral[0]).toMatchObject({ title: 'Кэшбэк от покупок друга', cashbackDeltaKop: 250 })
  })
})

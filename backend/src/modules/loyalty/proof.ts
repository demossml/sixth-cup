import { db } from '../../db'
import { signToken } from '../../lib/crypto'
import { activeVouchers } from '../vouchers/service'

export function ensureCard(userId: number) {
  db.prepare('INSERT OR IGNORE INTO cards(user_id, updated_at) VALUES(?,?)').run(userId, Date.now())
}

export function buildCardProof(userId: number): string {
  ensureCard(userId)
  const c = db.prepare('SELECT paid_total, free_used, seq FROM cards WHERE user_id=?')
    .get(userId) as { paid_total: number; free_used: number; seq: number }
  const u = db.prepare('SELECT cashback_balance FROM users WHERE id=?')
    .get(userId) as { cashback_balance: number }
  return signToken({
    t: 'c',
    u: userId,
    q: c.seq,
    p: c.paid_total,
    f: c.free_used,
    v: activeVouchers(userId),
    cb: u.cashback_balance,
    i: Math.floor(Date.now() / 1000),
  })
}

import { db } from '../../db'
import { bad } from '../../lib/errors'
import { verifyWith } from '../../lib/crypto'
import { serverPub } from '../../lib/crypto'
import { buildCardProof, ensureCard } from '../loyalty/proof'
import { freeEarned, cashbackOf } from '../loyalty/rules'
import { grantVoucher } from '../vouchers/service'
import { config } from '../../config'

export type SaleInput = {
  cardToken: string
  fiscalId: string
  amountRub: number
  useFree: boolean
  cashbackUseRub: number
  items: { productId?: number; name: string; qty: number; priceRub: number }[]
}

export type SaleResult = {
  ok: true
  card: string
  paidTotal: number
  freeUsed: number
  freeAvailable: number
  cashbackBalance: number
  cupsForFree: number
  appliedFree: number
  appliedCashback: number
  paidCups: number
}

/**
 * Онлайн-продажа: сервер считает стаканы/кэшбэк. fiscalId — идемпотентность.
 */
export function applyOnlineSale(deviceId: number, input: SaleInput): SaleResult {
  const payload = verifyWith(input.cardToken, serverPub) as {
    t?: string; u?: number; p?: number; f?: number; cb?: number; q?: number
  } | null
  if (!payload || payload.t !== 'c' || typeof payload.u !== 'number') {
    throw bad('Недействительная карта гостя', 400)
  }
  const userId = payload.u
  if (!db.prepare('SELECT id FROM users WHERE id=?').get(userId)) {
    throw bad('Карта не найдена', 404)
  }

  const fiscalKey = `${deviceId}:${input.fiscalId}`.slice(0, 80)
  const dup = db.prepare('SELECT id FROM receipts WHERE id=?').get(fiscalKey)
  if (dup) {
    // idempotent return current state
    ensureCard(userId)
    const c = db.prepare('SELECT paid_total, free_used FROM cards WHERE user_id=?')
      .get(userId) as { paid_total: number; free_used: number }
    const u = db.prepare('SELECT cashback_balance FROM users WHERE id=?')
      .get(userId) as { cashback_balance: number }
    const N = config.cupsForFree
    return {
      ok: true,
      card: buildCardProof(userId),
      paidTotal: c.paid_total,
      freeUsed: c.free_used,
      freeAvailable: Math.max(0, freeEarned(c.paid_total) - c.free_used),
      cashbackBalance: u.cashback_balance,
      cupsForFree: N,
      appliedFree: 0,
      appliedCashback: 0,
      paidCups: 0,
    }
  }

  ensureCard(userId)
  const before = db.prepare('SELECT paid_total, free_used FROM cards WHERE user_id=?')
    .get(userId) as { paid_total: number; free_used: number }
  const user = db.prepare('SELECT cashback_balance, invited_by FROM users WHERE id=?')
    .get(userId) as { cashback_balance: number; invited_by: number | null }

  // Count cups from items (product flag or fallback)
  let cupUnits = 0
  for (const it of input.items) {
    let isCup = false
    if (it.productId) {
      const row = db.prepare('SELECT counts_as_cup FROM products WHERE id=?')
        .get(it.productId) as { counts_as_cup: number } | undefined
      isCup = !!row?.counts_as_cup
    }
    if (!isCup) {
      const n = it.name.toLowerCase()
      isCup = /латте|капуч|американо|раф|эспрессо|флэт|flat|cappuccino|latte|americano/.test(n)
        || (n.includes('кофе') && !n.includes('печень'))
    }
    if (isCup) cupUnits += Math.max(1, it.qty)
  }

  let useFree = input.useFree ? 1 : 0
  const freeAvail = Math.max(0, freeEarned(before.paid_total) - before.free_used)
  if (useFree > freeAvail) useFree = freeAvail
  if (useFree > 0 && cupUnits < 1) useFree = 0

  let paidCups = Math.max(0, cupUnits - useFree)
  let cashbackUse = Math.max(0, Math.floor(input.cashbackUseRub))
  if (cashbackUse > user.cashback_balance) cashbackUse = user.cashback_balance
  if (cashbackUse > input.amountRub) cashbackUse = input.amountRub

  const amount = Math.max(0, Math.floor(input.amountRub))
  const now = Date.now()

  db.transaction(() => {
    db.prepare(`UPDATE cards SET paid_total = paid_total + ?, free_used = free_used + ?,
      seq = seq + 1, updated_at = ? WHERE user_id = ?`)
      .run(paidCups, useFree, now, userId)

    if (cashbackUse > 0) {
      db.prepare('UPDATE users SET cashback_balance = cashback_balance - ? WHERE id=?')
        .run(cashbackUse, userId)
    }

    // referral on paid amount after cashback
    const net = Math.max(0, amount - cashbackUse)
    if (net > 0 && user.invited_by) {
      const bonus = cashbackOf(net)
      if (bonus > 0) {
        db.prepare('UPDATE users SET cashback_balance = cashback_balance + ? WHERE id=?')
          .run(bonus, user.invited_by)
        db.prepare(`INSERT INTO cashback_ledger(beneficiary_id,from_user_id,receipt_id,amount,created_at)
          VALUES(?,?,?,?,?)`).run(user.invited_by, userId, fiscalKey, bonus, now)
      }
    }

    // WELCOME on first paid cups
    if (paidCups > 0 && before.paid_total <= 0) {
      try { grantVoucher(userId, 'WELCOME') } catch { /* */ }
    }

    db.prepare(`INSERT INTO receipts(id,device_id,user_id,dp,df,dcb,amount,ts,raw,applied_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      fiscalKey, deviceId, userId, paidCups, useFree, cashbackUse, amount,
      Math.floor(now / 1000), JSON.stringify({ online: true, items: input.items }), now
    )
  })()

  const after = db.prepare('SELECT paid_total, free_used FROM cards WHERE user_id=?')
    .get(userId) as { paid_total: number; free_used: number }
  const bal = db.prepare('SELECT cashback_balance FROM users WHERE id=?')
    .get(userId) as { cashback_balance: number }
  const N = config.cupsForFree

  return {
    ok: true,
    card: buildCardProof(userId),
    paidTotal: after.paid_total,
    freeUsed: after.free_used,
    freeAvailable: Math.max(0, freeEarned(after.paid_total) - after.free_used),
    cashbackBalance: bal.cashback_balance,
    cupsForFree: N,
    appliedFree: useFree,
    appliedCashback: cashbackUse,
    paidCups,
  }
}

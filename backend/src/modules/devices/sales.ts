import { db } from '../../db'
import { log } from '../../lib/logBuffer'
import { bad } from '../../lib/errors'
import { buildCardProof, ensureCard, verifyCardProof } from '../loyalty/proof'
import { freeEarned, cashbackOf } from '../loyalty/rules'
import { grantVoucherOnce } from '../vouchers/service'
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
  appliedCashbackRub: number
  paidCups: number
}

/**
 * Сколько чашек максимум может дать один онлайн-чек. Касса присылает состав сама,
 * поэтому щедрое ограничение защищает от «нарисованного» чека на 99 напитков (P1-1).
 */
const MAX_CUPS_PER_SALE = Number(process.env.MAX_CUPS_PER_SALE ?? 20)
/** Сколько онлайн-продаж допускаем с одного терминала в час. */
const SALES_PER_DEVICE_HOUR = Number(process.env.SALES_PER_DEVICE_HOUR ?? 120)

/** Частотный лимит по устройству: перебор чеков не должен начислять бесконечно. */
function allowSale(deviceId: number): void {
  const key = `sale-device:${deviceId}`
  const now = Date.now()
  const row = db.prepare('SELECT count, window_start FROM rate_limits WHERE key=?').get(key) as
    | { count: number; window_start: number }
    | undefined
  if (!row || now - row.window_start > 3_600_000) {
    db.prepare('INSERT OR REPLACE INTO rate_limits(key,count,window_start) VALUES(?,?,?)').run(key, 1, now)
    return
  }
  if (row.count >= SALES_PER_DEVICE_HOUR) throw bad('Слишком много чеков с терминала, попробуйте позже', 429)
  db.prepare('UPDATE rate_limits SET count=count+1 WHERE key=?').run(key)
}

export function applyOnlineSale(deviceId: number, input: SaleInput): SaleResult {
  const card = verifyCardProof(input.cardToken)
  if (!card) throw bad('Недействительная или просроченная карта гостя', 400)
  const userId = card.userId
  allowSale(deviceId)

  // Фискальный номер уникален у кассы: тот же номер с другого терминала — попытка переиграть чек.
  const dupOther = db.prepare(`SELECT device_id AS deviceId FROM receipts WHERE id LIKE ? AND device_id<>?`)
    .get(`%:${input.fiscalId}`, deviceId) as { deviceId: number } | undefined
  if (dupOther) {
    db.prepare(`INSERT INTO disputes(kind,details,created_at) VALUES(?,?,?)`)
      .run('fiscal_duplicate', `fiscal ${input.fiscalId} уже применён на устройстве ${dupOther.deviceId}`, Date.now())
    log.warn('online sale: fiscal id already used', { device: deviceId, fiscal: input.fiscalId })
    throw bad('Этот фискальный номер уже применён на другом терминале', 409)
  }
  const fiscalKey = `${deviceId}:${input.fiscalId}`.slice(0, 80)
  const dup = db.prepare('SELECT id FROM receipts WHERE id=?').get(fiscalKey)
  if (dup) {
    ensureCard(userId)
    const c = db.prepare('SELECT paid_total, free_used FROM cards WHERE user_id=?').get(userId) as { paid_total: number; free_used: number }
    const u = db.prepare('SELECT cashback_balance FROM users WHERE id=?').get(userId) as { cashback_balance: number }
    return {
      ok: true, card: buildCardProof(userId), paidTotal: c.paid_total, freeUsed: c.free_used,
      freeAvailable: Math.max(0, freeEarned(c.paid_total) - c.free_used), cashbackBalance: u.cashback_balance,
      cupsForFree: config.cupsForFree, appliedFree: 0, appliedCashbackRub: 0, paidCups: 0,
    }
  }

  ensureCard(userId)
  const before = db.prepare('SELECT paid_total, free_used FROM cards WHERE user_id=?').get(userId) as { paid_total: number; free_used: number }
  const user = db.prepare('SELECT cashback_balance, invited_by, card_id FROM users WHERE id=?').get(userId) as { cashback_balance: number; invited_by: number | null; card_id: string }

  let cupUnits = 0
  for (const it of input.items) {
    let isCup = false
    if (it.productId) {
      const row = db.prepare('SELECT counts_as_cup FROM products WHERE id=?').get(it.productId) as { counts_as_cup: number } | undefined
      isCup = !!row?.counts_as_cup
    }
    if (!isCup) {
      const n = it.name.toLowerCase()
      isCup = /латте|капуч|американо|раф|эспрессо|флэт|flat|cappuccino|latte|americano/.test(n)
        || (n.includes('кофе') && !n.includes('печень'))
    }
    if (isCup) cupUnits += Math.max(1, it.qty)
  }

  // Лимит на состав чека: больше MAX_CUPS_PER_SALE чашек за один чек не начисляем.
  if (cupUnits > MAX_CUPS_PER_SALE) {
    db.prepare(`INSERT INTO disputes(kind,details,created_at) VALUES(?,?,?)`)
      .run('cups_limit', `online sale: ${cupUnits} чашек в чеке ${input.fiscalId}`, Date.now())
    cupUnits = MAX_CUPS_PER_SALE
  }

  let useFree = input.useFree ? 1 : 0
  const freeAvail = Math.max(0, freeEarned(before.paid_total) - before.free_used)
  if (useFree > freeAvail || cupUnits < 1) useFree = 0
  const paidCups = Math.max(0, cupUnits - useFree)
  const amountKopecks = Math.max(0, Math.round(input.amountRub * 100))
  let cashbackUse = Math.max(0, Math.round(input.cashbackUseRub * 100))
  cashbackUse = Math.min(cashbackUse, user.cashback_balance, amountKopecks)
  // Нулевой чек с платными чашками — повод не начислять: касса могла прислать мусор.
  if (input.amountRub === 0 && paidCups > 0) {
    db.prepare(`INSERT INTO disputes(kind,details,created_at) VALUES(?,?,?)`)
      .run('zero_amount_with_cups', `online sale ${input.fiscalId}: ${paidCups} чашек при сумме 0`, Date.now())
    throw bad('Сумма чека 0 при платных позициях — начисление отклонено', 409)
  }
  const now = Date.now()

  db.transaction(() => {
    db.prepare(`UPDATE cards SET paid_total=paid_total+?,free_used=free_used+?,seq=seq+1,updated_at=? WHERE user_id=?`)
      .run(paidCups, useFree, now, userId)
    if (cashbackUse > 0) db.prepare('UPDATE users SET cashback_balance=cashback_balance-? WHERE id=?').run(cashbackUse, userId)
    const net = Math.max(0, amountKopecks - cashbackUse)
    if (net > 0 && user.invited_by) {
      const bonus = cashbackOf(net)
      if (bonus > 0) {
        db.prepare('UPDATE users SET cashback_balance=cashback_balance+? WHERE id=?').run(bonus, user.invited_by)
        db.prepare(`INSERT INTO cashback_ledger(beneficiary_id,from_user_id,receipt_id,amount,created_at) VALUES(?,?,?,?,?)`)
          .run(user.invited_by, userId, fiscalKey, bonus, now)
      }
    }
    if (paidCups > 0 && before.paid_total <= 0) {
      try { grantVoucherOnce(userId, 'WELCOME') } catch { /* шаблона может не быть */ }
    }
    db.prepare(`INSERT INTO receipts(id,device_id,user_id,dp,df,dcb,amount,ts,raw,applied_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(fiscalKey, deviceId, userId, paidCups, useFree, cashbackUse, amountKopecks, Math.floor(now / 1000), JSON.stringify({ online: true, items: input.items }), now)
    db.prepare(`INSERT INTO loyalty_ledger(card_id,operation,cups_delta,free_delta,cashback_delta,source_type,source_id,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(user.card_id, 'EARN', paidCups, useFree, -cashbackUse, 'ONLINE_SALE', fiscalKey, now)
  })()
  log.info('loyalty sell (online)', { device: deviceId, paidCups, free: useFree, cbKop: cashbackUse, amountKop: amountKopecks })

  const after = db.prepare('SELECT paid_total, free_used FROM cards WHERE user_id=?').get(userId) as { paid_total: number; free_used: number }
  const bal = db.prepare('SELECT cashback_balance FROM users WHERE id=?').get(userId) as { cashback_balance: number }
  return {
    ok: true, card: buildCardProof(userId), paidTotal: after.paid_total, freeUsed: after.free_used,
    freeAvailable: Math.max(0, freeEarned(after.paid_total) - after.free_used), cashbackBalance: bal.cashback_balance,
    cupsForFree: config.cupsForFree, appliedFree: useFree, appliedCashbackRub: cashbackUse / 100, paidCups,
  }
}

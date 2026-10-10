import type Database from 'better-sqlite3'
import { verifyServerToken } from '../../../lib/crypto'
import { normalizeCardCode } from '../../../modules/loyalty/proof'
import { cashbackOf, freeEarned } from '../../../modules/loyalty/rules'
import { consumeReservation } from '../../../modules/loyalty/reservations'
import { extractScRaw } from '../loyaltyExtras'

type Tx = Record<string, unknown>

type ScClaim = {
  v: number
  c: string
  q?: number
  op?: string
  free?: number
  cb?: number
  ts?: number
  kind?: 'token' | 'code'
}

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function number(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.replace(',', '.').trim())
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function transactions(doc: Record<string, unknown>): Tx[] {
  const tx = doc.transactions
  if (Array.isArray(tx)) return tx.filter((x): x is Tx => Boolean(obj(x)))
  const body = obj(doc.body)
  const positions = body?.positions
  if (Array.isArray(positions)) return positions.filter((x): x is Tx => Boolean(obj(x)))
  return []
}

function productUuid(tx: Tx): string | null {
  // Evotor Cloud V1 REGISTER_POSITION: commodityUuid (confirmed on live API 2026-10-09).
  const value =
    tx.commodityUuid ??
    tx.commodity_uuid ??
    tx.productUuid ??
    tx.product_uuid ??
    tx.productId ??
    tx.product_id ??
    tx.code
  return typeof value === 'string' && value ? value : null
}

function qty(tx: Tx): number {
  return Math.max(0, number(tx.quantity ?? tx.qty ?? 0))
}

function amountKopecks(doc: Record<string, unknown>, txs: Tx[]): number {
  /**
   * Evotor money scale is store-dependent:
   * - cloud / some stores: price=15000 for 150.00 RUB (already kopecks)
   * - some physical stores: price=150 for 150 RUB (rubles)
   * Detect by REGISTER_POSITION unit price: >= 1000 ⇒ already kopecks.
   */
  const positions = txs.filter((tx) => {
    const t = String(tx.type ?? '')
    return t === 'REGISTER_POSITION' || t === 'POSITION' || productUuid(tx) != null
  })
  const unitPrices = positions.map((tx) => number(tx.price ?? tx.resultPrice ?? tx.result_price)).filter((p) => p > 0)
  const alreadyKopecks = unitPrices.some((p) => p >= 1000)

  const body = obj(doc.body)
  const candidates = [
    doc.closeResultSum, doc.close_result_sum, doc.closeSum, doc.close_sum,
    body?.closeResultSum, body?.closeSum, body?.sum, doc.sum,
  ]
  for (const value of candidates) {
    const n = number(value)
    if (n > 0) return Math.round(alreadyKopecks ? n : n * 100)
  }
  const posSum = positions.reduce(
    (sum, tx) => sum + number(tx.resultSum ?? tx.result_sum ?? tx.sum ?? 0),
    0,
  )
  if (posSum > 0) return Math.round(alreadyKopecks ? posSum : posSum * 100)
  return 0
}


/** Evotor Cloud documents use `uuid`; some payloads use `id`. */
function documentIdOf(doc: Record<string, unknown>): string | null {
  const id = doc.uuid ?? doc.id
  return typeof id === 'string' && id ? id : null
}

function getSc(doc: Record<string, unknown>): ScClaim | null {
  const raw = extractScRaw(doc.extras)
  const sc = typeof raw === 'string' ? (() => { try { return JSON.parse(raw) } catch { return null } })() : obj(raw)
  if (!sc || typeof sc.v !== 'number' || sc.v < 2 || typeof sc.c !== 'string') return null
  return sc as unknown as ScClaim
}

function cupsForDocument(db: Database.Database, storeUuid: string, txs: Tx[]): number {
  let cups = 0
  const byEvotor = db.prepare(`
    SELECT p.counts_as_cup AS countsAsCup
    FROM evotor_products ep JOIN products p ON p.id=ep.product_id
    WHERE ep.store_uuid=? AND ep.evotor_uuid=?
  `)
  const byLink = db.prepare(`
    SELECT p.counts_as_cup AS countsAsCup
    FROM product_store_links l JOIN products p ON p.id=l.product_id
    WHERE l.store_uuid=? AND l.evotor_uuid=?
  `)
  for (const tx of txs) {
    const t = String(tx.type ?? '')
    if (t && t !== 'REGISTER_POSITION' && t !== 'POSITION') continue
    const uuid = productUuid(tx)
    if (!uuid) continue
    const row = (byEvotor.get(storeUuid, uuid) as { countsAsCup: number } | undefined)
      ?? (byLink.get(storeUuid, uuid) as { countsAsCup: number } | undefined)
    if (row?.countsAsCup) cups += Math.max(0, Math.floor(qty(tx)))
  }
  return cups
}

/** Pure helpers, exported so tests exercise the real code (not copies). */
export const sellInternals = { documentIdOf, productUuid, number, amountKopecks, transactions, getSc, cupsForDocument }

export function handleSell(db: Database.Database, storeUuid: string, doc: Record<string, unknown>): { processed: boolean; reason?: string } {
  const docId = documentIdOf(doc)
  if (!docId) return { processed: false, reason: 'missing document id' }
  const sc = getSc(doc)
  if (!sc) return { processed: false, reason: 'no loyalty extra' }

  const rawCard = sc.c.trim()
  let user: { id: number; card_id: string; card_code: string; cashback_balance: number; invited_by: number | null } | undefined

  // Preferred path: signed server token. The server, not the terminal, remains the source of truth.
  if (rawCard.includes('.')) {
    const card = verifyServerToken(rawCard)
    if (!card || card.t !== 'c' || card.ver !== 2 || typeof card.id !== 'string') {
      db.prepare(`INSERT INTO disputes(kind,details,created_at) VALUES(?,?,?)`)
        .run('bad_card_token', `SELL ${docId}: invalid signed card token`, Date.now())
      return { processed: false, reason: 'invalid signed card token' }
    }
    user = db.prepare('SELECT id, card_id, card_code, cashback_balance, invited_by FROM users WHERE card_id=?')
      .get(card.id) as typeof user
    if (!user) {
      db.prepare(`INSERT INTO disputes(kind,details,created_at) VALUES(?,?,?)`)
        .run('card_not_found', `SELL ${docId}: signed card id not found`, Date.now())
      return { processed: false, reason: 'card not found' }
    }
  } else {
    // Fallback path: human-entered/scanned numeric short code. Leading zeroes are ignored.
    const code = normalizeCardCode(rawCard)
    if (!code) {
      db.prepare(`INSERT INTO disputes(kind,details,created_at) VALUES(?,?,?)`)
        .run('bad_card_code', `SELL ${docId}: card code must contain digits only`, Date.now())
      return { processed: false, reason: 'invalid card code' }
    }
    user = db.prepare(`
      SELECT id, card_id, card_code, cashback_balance, invited_by
      FROM users
      WHERE card_code=? OR CAST(card_code AS INTEGER)=CAST(? AS INTEGER)
      LIMIT 1
    `).get(code, code) as typeof user
    if (!user) {
      db.prepare(`INSERT INTO disputes(kind,details,created_at) VALUES(?,?,?)`)
        .run('card_code_not_found', `SELL ${docId}: unknown card code ${code}`, Date.now())
      return { processed: false, reason: 'card code not found' }
    }
  }

  if (!user) return { processed: false, reason: 'card not found' }

  const existing = db.prepare('SELECT 1 FROM loyalty_ops WHERE doc_store=? AND doc_id=?').get(storeUuid, docId)
  if (existing) return { processed: true, reason: 'duplicate' }

  const txs = transactions(doc)
  const cups = cupsForDocument(db, storeUuid, txs)
  const before = db.prepare('SELECT paid_total, free_used, seq FROM cards WHERE user_id=?').get(user.id) as {
    paid_total: number; free_used: number; seq: number
  } | undefined
  if (!before) db.prepare('INSERT OR IGNORE INTO cards(user_id,updated_at) VALUES(?,?)').run(user.id, Date.now())
  const state = (before ?? db.prepare('SELECT paid_total, free_used, seq FROM cards WHERE user_id=?').get(user.id)) as {
    paid_total: number; free_used: number; seq: number
  }
  const freeAvail = Math.max(0, freeEarned(state.paid_total) - state.free_used)
  const amount = amountKopecks(doc, txs)
  const isToken = rawCard.includes('.')
  const claimedFree = Math.max(0, Math.floor(number(sc.free)))
  const claimedCb = Math.max(0, Math.floor(number(sc.cb)))
  // Benefits are only honoured for a signed QR with a server-issued reservation (sc.op).
  const reserved = isToken ? consumeReservation(db, sc.op, user.card_id, storeUuid, docId) : { free: 0, cb: 0 }
  const appliedFree = Math.min(reserved.free, claimedFree, freeAvail, cups)
  const appliedCb = Math.min(reserved.cb, claimedCb, user.cashback_balance, amount)
  const sequenceMatches = true
  const paidCups = Math.max(0, cups - appliedFree)
  const now = Date.now()
  const cardId = user.card_id
  const opClaimed = sc.op ?? null

  db.transaction(() => {
    db.prepare(`INSERT INTO loyalty_ops(doc_store,doc_id,kind,card_id,op_claimed,q_claimed,free,cb,disc_claimed,result_rub,cups_counted,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      storeUuid, docId, 'SELL', cardId, opClaimed, typeof sc.q === 'number' ? sc.q : null,
      appliedFree, appliedCb, null, amount / 100, cups, now,
    )
    db.prepare(`UPDATE cards SET paid_total=paid_total+?, free_used=free_used+?, seq=seq+1, updated_at=? WHERE user_id=?`)
      .run(paidCups, appliedFree, now, user.id)
    if (appliedCb > 0) {
      db.prepare('UPDATE users SET cashback_balance=cashback_balance-? WHERE id=?').run(appliedCb, user.id)
    }
    if (paidCups || appliedFree || appliedCb) {
      db.prepare(`INSERT INTO loyalty_ledger(card_id,operation,cups_delta,free_delta,cashback_delta,source_type,source_id,created_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(cardId, 'EARN', paidCups, appliedFree, -appliedCb, 'EVOTOR_SELL', docId, now)
    }
    if (amount > 0 && user.invited_by) {
      const bonus = cashbackOf(Math.max(0, amount - appliedCb))
      if (bonus > 0) {
        const beneficiary = db.prepare('SELECT card_id FROM users WHERE id=?').get(user.invited_by) as { card_id: string | null } | undefined
        db.prepare('UPDATE users SET cashback_balance=cashback_balance+? WHERE id=?').run(bonus, user.invited_by)
        db.prepare(`INSERT INTO cashback_ledger(beneficiary_id,from_user_id,receipt_id,amount,created_at) VALUES(?,?,?,?,?)`)
          .run(user.invited_by, user.id, docId, bonus, now)
        if (beneficiary?.card_id) {
          db.prepare(`INSERT INTO loyalty_ledger(card_id,operation,cups_delta,free_delta,cashback_delta,source_type,source_id,created_at)
            VALUES(?,?,?,?,?,?,?,?)`).run(beneficiary.card_id, 'EARN', 0, 0, bonus, 'REFERRAL', docId, now)
        }
      }
    }
    if (appliedFree !== claimedFree || appliedCb !== claimedCb) {
      db.prepare(`INSERT INTO disputes(kind,user_id,receipt_id,details,created_at) VALUES(?,?,?,?,?)`)
        .run('loyalty_claim_clamped', user.id, docId, JSON.stringify({ claimedFree, appliedFree, claimedCb, appliedCb, sequenceMatches, claimedSeq: sc.q, currentSeq: state.seq }), now)
    }
  })()

  return { processed: true }
}

export function handlePayback(db: Database.Database, storeUuid: string, doc: Record<string, unknown>): { processed: boolean; reason?: string } {
  const docId = documentIdOf(doc)
  if (!docId) return { processed: false, reason: 'missing document id' }
  if (db.prepare('SELECT 1 FROM loyalty_ops WHERE doc_store=? AND doc_id=?').get(storeUuid, docId)) return { processed: true, reason: 'duplicate' }
  const body = obj(doc.body)
  const baseId = String(doc.baseDocumentUUID ?? doc.base_document_uuid ?? body?.baseDocumentUUID ?? body?.base_document_id ?? '').trim()
  if (!baseId) return { processed: false, reason: 'missing baseDocumentUUID' }
  const original = db.prepare(`SELECT * FROM loyalty_ops WHERE doc_store=? AND doc_id=? AND kind='SELL'`).get(storeUuid, baseId) as Record<string, unknown> | undefined
  if (!original || typeof original.card_id !== 'string') return { processed: false, reason: 'base SELL not found' }
  const user = db.prepare('SELECT id, cashback_balance, card_id FROM users WHERE card_id=?').get(original.card_id) as {
    id: number; cashback_balance: number; card_id: string
  } | undefined
  if (!user) return { processed: false, reason: 'card not found' }
  const now = Date.now()

  // Proportional reversal: share of the original sale refunded by this PAYBACK, capped by what is not yet reversed.
  const origRub = Math.max(0, Number(original.result_rub ?? 0))
  const paybackRub = amountKopecks(doc, transactions(doc)) / 100
  const prev = db.prepare(`SELECT COALESCE(SUM(result_rub),0) AS rub, COALESCE(SUM(cups_counted),0) AS cups, COALESCE(SUM(free),0) AS free, COALESCE(SUM(cb),0) AS cb
    FROM loyalty_ops WHERE doc_store=? AND kind='PAYBACK' AND op_claimed=?`).get(storeUuid, baseId) as { rub: number; cups: number; free: number; cb: number }
  const remaining = Math.max(0, origRub - prev.rub)
  const thisRub = origRub > 0 && paybackRub > 0 ? Math.min(paybackRub, remaining) : remaining
  const cumFrac = origRub > 0 ? Math.min(1, (prev.rub + thisRub) / origRub) : 1
  const full = cumFrac >= 0.999999
  const origCups = Math.max(0, Number(original.cups_counted ?? 0))
  const origFree = Math.max(0, Number(original.free ?? 0))
  const origCb = Math.max(0, Number(original.cb ?? 0))
  const cups = Math.max(0, (full ? origCups : Math.floor(origCups * cumFrac)) - prev.cups)
  const free = Math.max(0, (full ? origFree : Math.floor(origFree * cumFrac)) - prev.free)
  const cb = Math.max(0, (full ? origCb : Math.floor(origCb * cumFrac)) - prev.cb)
  const fracDelta = origRub > 0 ? thisRub / origRub : 1
  db.transaction(() => {
    db.prepare(`INSERT INTO loyalty_ops(doc_store,doc_id,kind,card_id,op_claimed,q_claimed,free,cb,disc_claimed,result_rub,cups_counted,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(storeUuid, docId, 'PAYBACK', user.card_id, baseId, null, free, cb, null, thisRub, cups, now)
    db.prepare(`UPDATE cards SET paid_total=MAX(0,paid_total-?), free_used=MAX(0,free_used-?), seq=seq+1, updated_at=? WHERE user_id=?`)
      .run(Math.max(0, cups - free), free, now, user.id)
    if (cb > 0) db.prepare('UPDATE users SET cashback_balance=cashback_balance+? WHERE id=?').run(cb, user.id)
    db.prepare(`INSERT INTO loyalty_ledger(card_id,operation,cups_delta,free_delta,cashback_delta,source_type,source_id,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(user.card_id, 'REVERSAL', -Math.max(0, cups - free), -free, cb, 'EVOTOR_PAYBACK', docId, now)
    const refs = db.prepare('SELECT beneficiary_id, amount FROM cashback_ledger WHERE receipt_id=? AND amount>0').all(baseId) as { beneficiary_id: number; amount: number }[]
    for (const ref of refs) {
      const amount = full && prev.rub === 0 ? ref.amount : Math.floor(ref.amount * fracDelta)
      if (amount <= 0) continue
      db.prepare('UPDATE users SET cashback_balance=MAX(0,cashback_balance-?) WHERE id=?').run(amount, ref.beneficiary_id)
      db.prepare(`INSERT INTO cashback_ledger(beneficiary_id,from_user_id,receipt_id,amount,created_at) VALUES(?,?,?,?,?)`)
        .run(ref.beneficiary_id, user.id, baseId, -amount, now)
      const beneficiary = db.prepare('SELECT card_id FROM users WHERE id=?').get(ref.beneficiary_id) as { card_id: string | null } | undefined
      if (beneficiary?.card_id) {
        db.prepare(`INSERT INTO loyalty_ledger(card_id,operation,cups_delta,free_delta,cashback_delta,source_type,source_id,created_at)
          VALUES(?,?,?,?,?,?,?,?)`).run(beneficiary.card_id, 'REVERSAL', 0, 0, -amount, 'EVOTOR_PAYBACK_REFERRAL', docId, now)
      }
    }
  })()
  return { processed: true }
}

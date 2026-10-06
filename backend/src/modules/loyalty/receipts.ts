import { z } from 'zod'
import { db } from '../../db'
import { peek, verifyWith } from '../../lib/crypto'
import { ensureCard } from './proof'
import { cashbackOf, freeEarned } from './rules'
import { grantVoucher } from '../vouchers/service'

const receiptSchema = z.object({
  t: z.literal('r'),
  r: z.string().min(3).max(60),
  u: z.number().int().positive(),
  d: z.number().int().positive(),
  q: z.number().int().min(0),
  p: z.number().int().min(0),
  f: z.number().int().min(0),
  v: z.array(z.tuple([z.number(), z.enum(['p', 'f']), z.number(), z.number()])).max(10),
  cb: z.number().int().min(0),
  dp: z.number().int().min(0).max(50),
  df: z.number().int().min(0).max(3),
  dcb: z.number().int().min(0).max(50_000),
  vu: z.array(z.number().int()).max(3),
  a: z.number().int().min(0).max(1_000_000),
  ts: z.number().int(),
})
type Receipt = z.infer<typeof receiptSchema>

export type ApplyResult = {
  applied: string[]
  duplicates: string[]
  rejected: { reason: string }[]
}

function dispute(kind: string, userId: number, receiptId: string, details: string) {
  db.prepare('INSERT INTO disputes(kind,user_id,receipt_id,details,created_at) VALUES(?,?,?,?,?)')
    .run(kind, userId, receiptId, details, Date.now())
}

function applyOne(r: Receipt) {
  ensureCard(r.u)
  const userRow = db.prepare('SELECT card_id FROM users WHERE id=?').get(r.u) as { card_id: string }

  db.prepare(`UPDATE cards SET paid_total = paid_total + ?, free_used = free_used + ?,
              seq = MAX(seq, ?) + 1, updated_at = ? WHERE user_id = ?`)
    .run(r.dp, r.df, r.q, Date.now(), r.u)

  if (r.dp || r.df || r.dcb) {
    db.prepare(`INSERT INTO loyalty_ledger(card_id,operation,cups_delta,free_delta,cashback_delta,source_type,source_id,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(userRow.card_id, 'EARN', r.dp, r.df, -r.dcb, 'CLIENT_RECEIPT', r.r, Date.now())
  }

  // WELCOME после первой оплаты (не при создании гостя)
  if (r.dp > 0) {
    const beforePaid = (db.prepare('SELECT paid_total FROM cards WHERE user_id=?').get(r.u) as { paid_total: number }).paid_total - r.dp
    if (beforePaid <= 0) {
      try { grantVoucher(r.u, 'WELCOME') } catch { /* already has or no template */ }
    }
  }

  if (r.dcb > 0) {
    const u = db.prepare('SELECT cashback_balance FROM users WHERE id=?')
      .get(r.u) as { cashback_balance: number }
    if (u.cashback_balance < r.dcb) {
      dispute('cashback_overdraw', r.u, r.r, `tried ${r.dcb}, had ${u.cashback_balance}`)
    } else {
      db.prepare('UPDATE users SET cashback_balance = cashback_balance - ? WHERE id=?')
        .run(r.dcb, r.u)
    }
  }

  for (const id of r.vu) {
    const v = db.prepare('SELECT user_id, used_at FROM vouchers WHERE id=?')
      .get(id) as { user_id: number; used_at: number | null } | undefined
    if (!v || v.user_id !== r.u) dispute('voucher_invalid', r.u, r.r, `voucher ${id}`)
    else if (v.used_at) dispute('voucher_double_use', r.u, r.r, `voucher ${id} already used`)
    else db.prepare('UPDATE vouchers SET used_at=?, receipt_id=? WHERE id=?').run(Date.now(), r.r, id)
  }

  const after = db.prepare('SELECT paid_total, free_used FROM cards WHERE user_id=?')
    .get(r.u) as { paid_total: number; free_used: number }
  if (after.free_used > freeEarned(after.paid_total))
    dispute('free_cup_overdraw', r.u, r.r, `free_used=${after.free_used}, earned=${freeEarned(after.paid_total)}`)

  if (r.a > 0) {
    const u = db.prepare('SELECT invited_by FROM users WHERE id=?').get(r.u) as { invited_by: number | null }
    if (u.invited_by) {
      const bonus = cashbackOf(r.a)
      if (bonus > 0) {
        db.prepare('UPDATE users SET cashback_balance = cashback_balance + ? WHERE id=?')
          .run(bonus, u.invited_by)
        db.prepare(`INSERT INTO cashback_ledger(beneficiary_id,from_user_id,receipt_id,amount,created_at)
                    VALUES(?,?,?,?,?)`)
          .run(u.invited_by, r.u, r.r, bonus, Date.now())
      }
    }
  }
}

export const applyReceipts = db.transaction((tokens: string[]): ApplyResult => {
  const result: ApplyResult = { applied: [], duplicates: [], rejected: [] }
  const now = Math.floor(Date.now() / 1000)

  for (const token of tokens.slice(0, 200)) {
    const head = peek(token)
    if (head?.t !== 'r' || typeof head.d !== 'number') { result.rejected.push({ reason: 'bad format' }); continue }

    const dev = db.prepare('SELECT public_key, revoked FROM devices WHERE id=?')
      .get(head.d) as { public_key: string | null; revoked: number } | undefined
    if (!dev?.public_key || dev.revoked) { result.rejected.push({ reason: 'unknown or revoked device' }); continue }

    const parsed = receiptSchema.safeParse(verifyWith(token, dev.public_key))
    if (!parsed.success) { result.rejected.push({ reason: 'bad signature' }); continue }
    const r = parsed.data

    if (!r.r.startsWith(`${r.d}-`) || r.ts > now + 86_400) { result.rejected.push({ reason: 'bad receipt' }); continue }
    if (!db.prepare('SELECT 1 FROM users WHERE id=?').get(r.u)) { result.rejected.push({ reason: 'unknown user' }); continue }
    const current = db.prepare('SELECT seq FROM cards WHERE user_id=?').get(r.u) as { seq: number } | undefined
    if (current && r.q <= current.seq) {
      dispute('stale_receipt_sequence', r.u, r.r, `q=${r.q}, current=${current.seq}`)
      result.rejected.push({ reason: 'stale receipt sequence' })
      continue
    }

    const ins = db.prepare(`INSERT OR IGNORE INTO receipts(id,device_id,user_id,dp,df,dcb,amount,ts,raw,applied_at)
                            VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(r.r, r.d, r.u, r.dp, r.df, r.dcb, r.a, r.ts, token, Date.now())
    if (ins.changes === 0) { result.duplicates.push(r.r); continue }

    applyOne(r)
    result.applied.push(r.r)
  }
  return result
})

import { db } from '../../db'
import { config } from '../../config'

export type VoucherTuple = [number, 'p' | 'f', number, number]

export const todayDay = () => Math.floor(Date.now() / 86_400_000)

export function grantVoucher(userId: number, code: string) {
  const t = db.prepare('SELECT * FROM voucher_templates WHERE code=?').get(code) as
    | { id: number; title: string; kind: string; value: number; valid_days: number }
    | undefined
  if (!t) throw new Error(`Unknown voucher template ${code}`)
  db.prepare(`INSERT INTO vouchers(user_id,template_id,title,kind,value,expires_day)
              VALUES(?,?,?,?,?,?)`).run(userId, t.id, t.title, t.kind, t.value, todayDay() + t.valid_days)
}

/**
 * Идемпотентная выдача: один ваучер этого шаблона на гостя (L-09).
 * Проверка и вставка — одним оператором, гонка двух каналов не создаёт дубликат.
 * Возвращает true, если ваучер реально выдан сейчас.
 */
export function grantVoucherOnce(userId: number, code: string): boolean {
  const t = db.prepare('SELECT * FROM voucher_templates WHERE code=?').get(code) as
    | { id: number; title: string; kind: string; value: number; valid_days: number }
    | undefined
  if (!t) throw new Error(`Unknown voucher template ${code}`)
  const r = db
    .prepare(
      `INSERT INTO vouchers(user_id,template_id,title,kind,value,expires_day)
       SELECT ?,?,?,?,?,?
       WHERE NOT EXISTS (SELECT 1 FROM vouchers WHERE user_id=? AND template_id=?)`,
    )
    .run(userId, t.id, t.title, t.kind, t.value, todayDay() + t.valid_days, userId, t.id)
  return r.changes === 1
}

export function activeVouchers(userId: number): VoucherTuple[] {
  const rows = db.prepare(`
    SELECT id, kind, value, expires_day FROM vouchers
    WHERE user_id=? AND used_at IS NULL AND expires_day>=?
    ORDER BY expires_day LIMIT ?`)
    .all(userId, todayDay(), config.maxVouchersInCard) as
    { id: number; kind: string; value: number; expires_day: number }[]
  return rows.map((r): VoucherTuple => [r.id, r.kind === 'percent' ? 'p' : 'f', r.value, r.expires_day])
}

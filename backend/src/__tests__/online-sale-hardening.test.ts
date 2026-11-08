/**
 * P1-1: онлайн-продажа с кассы не должна начислять что угодно.
 *
 * Касса присылает состав и сумму сама, поэтому сервер ограничивает чашки за чек,
 * не начисляет при нулевой сумме и не принимает один фискальный номер с двух терминалов.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'sc-online-sale-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'
process.env.MAX_CUPS_PER_SALE = '5'

const { db } = await import('../db')
const { applyOnlineSale } = await import('../modules/devices/sales')
const { buildCardProof } = await import('../modules/loyalty/proof')

let seq = 0
const uniq = () => `fiscal-${++seq}`

type Guest = { userId: number; token: string }

function mkGuest(): Guest {
  const t = Math.floor(Date.now() / 1000)
  const code = String(9200 + ++seq)
  db.prepare(`INSERT INTO users(nickname, phone, invite_code, card_id, card_code, created_at)
    VALUES(?,?,?,?,?,?)`).run(`sale-${code}`, `+7500${code}`, `SALE${code}`, `CARD-${code}`, code, t)
  const id = Number((db.prepare('SELECT MAX(id) AS id FROM users').get() as { id: number }).id)
  db.prepare('INSERT OR IGNORE INTO cards(user_id, updated_at) VALUES(?,?)').run(id, t)
  return { userId: id, token: buildCardProof(id) }
}

const cup = (qty: number) => ({ name: 'Капучино', qty, priceRub: 300 })

beforeEach(() => {
  db.prepare('DELETE FROM receipts').run()
  db.prepare('DELETE FROM disputes').run()
  db.prepare('DELETE FROM rate_limits').run()
})

describe('P1-1 онлайн-продажа', () => {
  it('чашки за чек ограничены MAX_CUPS_PER_SALE', () => {
    const g = mkGuest()
    const res = applyOnlineSale(1, {
      cardToken: g.token, fiscalId: uniq(), amountRub: 99999, useFree: false,
      cashbackUseRub: 0, items: [cup(30)],
    })
    expect(res.paidCups).toBe(5)
    const dispute = db.prepare(`SELECT details FROM disputes WHERE kind='cups_limit'`).get() as { details: string } | undefined
    expect(dispute?.details).toContain('30')
  })

  it('нулевая сумма с платными чашками — отказ, без начисления', () => {
    const g = mkGuest()
    expect(() => applyOnlineSale(1, {
      cardToken: g.token, fiscalId: uniq(), amountRub: 0, useFree: false,
      cashbackUseRub: 0, items: [cup(1)],
    })).toThrow(/Сумма чека 0/)
    const card = db.prepare('SELECT paid_total FROM cards WHERE user_id=?').get(g.userId) as { paid_total: number }
    expect(card.paid_total).toBe(0)
  })

  it('тот же фискальный номер с другого терминала — 409 и спор', () => {
    const g = mkGuest()
    const fiscalId = uniq()
    applyOnlineSale(1, { cardToken: g.token, fiscalId, amountRub: 300, useFree: false, cashbackUseRub: 0, items: [cup(1)] })
    expect(() => applyOnlineSale(2, {
      cardToken: g.token, fiscalId, amountRub: 300, useFree: false, cashbackUseRub: 0, items: [cup(1)],
    })).toThrow(/фискальный номер/)
    const dispute = db.prepare(`SELECT details FROM disputes WHERE kind='fiscal_duplicate'`).get() as { details: string } | undefined
    expect(dispute?.details).toBeTruthy()
  })

  it('повтор того же чека на том же терминале идемпотентен', () => {
    const g = mkGuest()
    const fiscalId = uniq()
    const first = applyOnlineSale(1, { cardToken: g.token, fiscalId, amountRub: 300, useFree: false, cashbackUseRub: 0, items: [cup(1)] })
    const second = applyOnlineSale(1, { cardToken: g.token, fiscalId, amountRub: 300, useFree: false, cashbackUseRub: 0, items: [cup(1)] })
    expect(second.paidTotal).toBe(first.paidTotal)
    expect(second.appliedFree).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import { normalizeCardCode } from '../modules/loyalty/proof'

describe('manual loyalty card codes', () => {
  it('accepts digits and normalizes leading zeroes', () => {
    expect(normalizeCardCode('0042')).toBe('42')
    expect(normalizeCardCode('42')).toBe('42')
    expect(normalizeCardCode('0001')).toBe('1')
  })

  it('accepts the number exactly as the guest sees it (groups of four)', () => {
    // formatCardCode в PWA: код 12345 показывается как «1 2345» (пробел каждые 4 цифры)
    expect(normalizeCardCode('1 2345')).toBe('12345')
    expect(normalizeCardCode('1234 5678')).toBe('12345678')
    expect(normalizeCardCode('\u00a01234\u00a05678')).toBe('12345678')
    expect(normalizeCardCode('0123 4567')).toBe('1234567')
  })

  it('tolerates a typographic dash from printed cards', () => {
    expect(normalizeCardCode('42-1')).toBe('421')
    expect(normalizeCardCode('1234–5678')).toBe('12345678')
  })

  it('rejects non-numeric and oversized input', () => {
    expect(normalizeCardCode('abc')).toBeNull()
    expect(normalizeCardCode('1234 56ab')).toBeNull()
    expect(normalizeCardCode('1'.repeat(19))).toBeNull()
    expect(normalizeCardCode('   ')).toBeNull()
  })
})

describe('cards are real backend records and stay single', () => {
  it('assigns one card_id and one card_code per user, repeat calls change nothing', async () => {
    const { db } = await import('../db')
    const { ensureCard } = await import('../modules/loyalty/proof')
    const t = Date.now()
    const uid = Number(db.prepare(`INSERT INTO users(phone,nickname,invite_code,created_at) VALUES(?,?,?,?)`)
      .run(`guest:${t}`, 'Гость ТЕСТ', `T${t.toString(36).toUpperCase()}`, t).lastInsertRowid)

    ensureCard(uid)
    const first = db.prepare('SELECT card_id, card_code FROM users WHERE id=?').get(uid) as { card_id: string; card_code: string }
    expect(first.card_id).toBeTruthy()
    expect(first.card_code).toMatch(/^\d+$/)
    const cards = db.prepare('SELECT COUNT(*) AS n FROM cards WHERE user_id=?').get(uid) as { n: number }

    ensureCard(uid)
    ensureCard(uid)
    const again = db.prepare('SELECT card_id, card_code FROM users WHERE id=?').get(uid) as { card_id: string; card_code: string }
    const cardsAfter = db.prepare('SELECT COUNT(*) AS n FROM cards WHERE user_id=?').get(uid) as { n: number }
    expect(again).toEqual(first)
    expect(cardsAfter.n).toBe(cards.n)
    expect(cardsAfter.n).toBe(1)
  })

  it('gives different guests different codes', async () => {
    const { db } = await import('../db')
    const { createGuestUser } = await import('../modules/auth/service')
    const a = createGuestUser()
    const b = createGuestUser()
    const ca = db.prepare('SELECT card_code FROM users WHERE id=?').get(a) as { card_code: string }
    const cb = db.prepare('SELECT card_code FROM users WHERE id=?').get(b) as { card_code: string }
    expect(ca.card_code).not.toBe(cb.card_code)
  })
})

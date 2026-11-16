/**
 * Телефон → гость: нормализация, поиск, регистрация с согласием, идемпотентность.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, beforeEach } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'sc-bonus-phone-'))
process.env.DB_PATH = join(dir, 'test.db')
process.env.KEYS_PATH = join(dir, 'keys.json')
process.env.UPLOADS_DIR = join(dir, 'uploads')
process.env.ADMIN_TOKEN = 'test-admin'
process.env.NODE_ENV = 'development'

const { db } = await import('../db')
const { normalizePhoneRu, maskPhone, isGuestPhone, samePhone } = await import('../modules/loyalty/phone')
const { registerByPhone, customerByPhone, findUserByPhone, ledgerForUser } = await import('../modules/loyalty/customers')

let seq = 0
const uniqPhone = () => `9${String(100000000 + ++seq).slice(0, 9)}`

beforeEach(() => {
  seq += 0
})

describe('normalizePhoneRu', () => {
  it('приводит все распространённые формы к 7XXXXXXXXXX', () => {
    const expected = '79991234567'
    for (const input of [
      '9991234567',
      '+79991234567',
      '7 999 123-45-67',
      '8 (999) 123 45 67',
      '89991234567',
      '+7 (999) 123 45 67',
      '0079991234567',
    ]) {
      expect(normalizePhoneRu(input)).toBe(expected)
    }
  })

  it('отвергает мусор, городские с кодом 0/1 и гостевые псевдо-номера', () => {
    expect(normalizePhoneRu('')).toBeNull()
    expect(normalizePhoneRu('abcdef')).toBeNull()
    expect(normalizePhoneRu('123')).toBeNull()
    expect(normalizePhoneRu('guest:abcdef0123456789')).toBeNull()
    expect(normalizePhoneRu('+1 415 555 2671')).toBeNull()
  })

  it('isGuestPhone и samePhone', () => {
    expect(isGuestPhone('guest:abc')).toBe(true)
    expect(isGuestPhone('79991234567')).toBe(false)
    expect(samePhone('+7 999 123-45-67', '89991234567')).toBe(true)
    expect(samePhone('79991234567', '79990000000')).toBe(false)
  })

  it('маска не раскрывает номер целиком', () => {
    const m = maskPhone('79991234567')
    expect(m).toBe('+7 ••• ••• 45 67')
    expect(m).not.toContain('999')
    expect(m).not.toContain('123')
  })
})

describe('registerByPhone / customerByPhone', () => {
  it('создаёт гостя, карту и запоминает согласие', () => {
    const phone = uniqPhone()
    const r = registerByPhone({ phone, pdConsent: true, pdConsentVersion: 'v1', source: 'test' })
    expect(r.created).toBe(true)
    expect(r.customer.cardCode).toMatch(/^\d+$/)
    expect(r.customer.cardId.length).toBeGreaterThan(10)
    expect(r.customer.balanceKopecks).toBe(0)
    expect(r.customer.effectiveEarnPercent).toBe(5) // глобальный дефолт
    expect(r.customer.earnSource).toBe('global')
    expect(r.customer.pdConsentVersion).toBe('v1')
    expect(r.customer.pdConsentAt).toBeGreaterThan(0)
    expect(r.customer.phoneMasked).toMatch(/^\+7 ••• ••• \d\d \d\d$/)

    const row = db.prepare('SELECT phone, phone_bound_at FROM users WHERE id=?').get(r.customer.userId) as
      { phone: string; phone_bound_at: number | null }
    expect(row.phone).toBe(normalizePhoneRu(phone))
    expect(row.phone_bound_at).not.toBeNull()
  })

  it('повторный вызов с тем же номером возвращает того же гостя', () => {
    const phone = uniqPhone()
    const a = registerByPhone({ phone, pdConsent: true, pdConsentVersion: 'v1' })
    const b = registerByPhone({ phone: `+7 ${phone.slice(0, 3)} ${phone.slice(3)}`, pdConsent: true, pdConsentVersion: 'v1' })
    expect(b.created).toBe(false)
    expect(b.customer.userId).toBe(a.customer.userId)
    expect(b.customer.cardCode).toBe(a.customer.cardCode)
    const count = db.prepare('SELECT COUNT(*) AS n FROM users WHERE phone=?').get(normalizePhoneRu(phone)) as { n: number }
    expect(count.n).toBe(1)
  })

  it('без согласия или без версии согласия — 400', () => {
    const phone = uniqPhone()
    expect(() => registerByPhone({ phone, pdConsent: false, pdConsentVersion: 'v1' })).toThrowError(/согласие/i)
    expect(() => registerByPhone({ phone, pdConsent: true, pdConsentVersion: '' })).toThrowError(/версия/i)
  })

  it('некорректный телефон — 400', () => {
    expect(() => registerByPhone({ phone: '123', pdConsent: true, pdConsentVersion: 'v1' })).toThrowError(/телефон/i)
  })

  it('поиск по телефону в любом формате; неизвестный номер — null', () => {
    const phone = uniqPhone()
    const created = registerByPhone({ phone, pdConsent: true, pdConsentVersion: 'v1' })
    expect(customerByPhone(`+7${phone}`)?.userId).toBe(created.customer.userId)
    expect(customerByPhone(`8${phone.slice(1)}`)?.userId ?? null).toBeNull() // 10 цифр с 8 — не РФ-номер
    expect(findUserByPhone(phone)?.id).toBe(created.customer.userId)
    expect(customerByPhone('9990000000')).toBeNull()
  })

  it('ledgerForUser отдаёт движения карты (пустой на старте)', () => {
    const phone = uniqPhone()
    const created = registerByPhone({ phone, pdConsent: true, pdConsentVersion: 'v1' })
    expect(ledgerForUser(created.customer.userId)).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import { parseBankText, parseBankLine } from './BankTab'

describe('bank statement parsing', () => {
  it('parses a full row with russian decimal comma', () => {
    const r = parseBankLine('2026-10-24; ООО Ромашка; Оплата по счёту 154; 12 500,50')
    expect(typeof r).toBe('object')
    if (typeof r === 'string') return
    expect(r.amountKop).toBe(1250050)
    expect(r.party).toBe('ООО Ромашка')
    expect(r.purpose).toBe('Оплата по счёту 154')
    expect(new Date(r.dateAt).getFullYear()).toBe(2026)
  })

  it('accepts tab separated rows and keeps negative amounts as outflow', () => {
    const r = parseBankLine('2026-10-25\tИП Иванов\tВнесение\t-3000')
    if (typeof r === 'string') throw new Error(r)
    expect(r.amountKop).toBe(-300000)
    expect(r.party).toBe('ИП Иванов')
  })

  it('allows the short form «date; amount»', () => {
    const r = parseBankLine('2026-10-25; 990')
    if (typeof r === 'string') throw new Error(r)
    expect(r.amountKop).toBe(99000)
    expect(r.party).toBeNull()
  })

  it('rejects a row without a recognised date or amount', () => {
    expect(typeof parseBankLine('вчера; 100')).toBe('string')
    expect(typeof parseBankLine('2026-10-25; 0')).toBe('string')
    expect(typeof parseBankLine('2026-10-25')).toBe('string')
  })

  it('collects errors per line instead of dropping the whole paste', () => {
    const { rows, errors } = parseBankText(
      ['2026-10-24; Ромашка; счёт 1; 100', '', 'мусор', '2026-10-25; Ромашка; счёт 2; 200'].join('\n'),
    )
    expect(rows).toHaveLength(2)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('Строка 3')
  })
})

import { describe, expect, it } from 'vitest'
import { hasFieldLabels, splitPromoText } from './promoSplit'

describe('hasFieldLabels', () => {
  it('видит подписи полей', () => {
    expect(hasFieldLabels('Утро −30% Краткое описание Средний капучино')).toBe(true)
    expect(hasFieldLabels('Полное описание для карточки\nтекст')).toBe(true)
    expect(hasFieldLabels('Условия: до 12:00')).toBe(true)
  })

  it('обычный текст не считает склейкой', () => {
    expect(hasFieldLabels('Утро −30% на средний капучино')).toBe(false)
    expect(hasFieldLabels('')).toBe(false)
    expect(hasFieldLabels(null)).toBe(false)
  })
})

describe('splitPromoText', () => {
  it('разбирает склейку в одну строку (случай из аудита)', () => {
    const blob =
      'Утро −30% Краткое описание Средний капучино со скидкой 30% Полное описание для карточки ' +
      'Каждый день до 12:00 средний капучино со скидкой 30%. Просто закажите средний капучино — скидка применится автоматически. ' +
      'Условия Только средний размер • Действует до 12:00 • Не суммируется с другими акциями'

    const r = splitPromoText(blob)
    expect(r.found).toBe(true)
    expect(r.title).toBe('Утро −30%')
    expect(r.subtitle).toBe('Средний капучино со скидкой 30%')
    expect(r.body).toContain('Каждый день до 12:00')
    expect(r.body).toContain('скидка применится автоматически')
    expect(r.terms).toContain('Только средний размер')
    expect(r.body).not.toContain('Краткое описание')
    expect(r.body).not.toContain('Полное описание')
  })

  it('разбирает вариант с новой строки', () => {
    const blob = 'Название\nУтро −30%\nКраткое описание\nСредний капучино\nУсловия:\nдо 12:00'
    const r = splitPromoText(blob)
    expect(r.title).toBe('Утро −30%')
    expect(r.subtitle).toBe('Средний капучино')
    expect(r.terms).toBe('до 12:00')
  })

  it('без подписей всё уходит в заголовок, found=false', () => {
    const r = splitPromoText('Утро −30%')
    expect(r.found).toBe(false)
    expect(r.title).toBe('Утро −30%')
    expect(r.subtitle).toBe('')
    expect(r.body).toBe('')
  })

  it('не оставляет мусорных двоеточий и лишних пробелов', () => {
    const r = splitPromoText('Заголовок:   Утро  −30%   Краткое описание :  Капучино')
    expect(r.title).toBe('Утро −30%')
    expect(r.subtitle).toBe('Капучино')
  })

  it('пустая строка не ломает разбор', () => {
    const r = splitPromoText('')
    expect(r).toEqual({ title: '', subtitle: '', body: '', terms: '', found: false })
  })
})

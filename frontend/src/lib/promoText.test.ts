/**
 * Разбор текста акции: заголовок не обрезается по букве, «Условия» — отдельный список.
 * Данные — реальные из прод-каталога 15.11.2026 (title пустой, terms null, всё в body).
 */
import { describe, expect, it } from 'vitest'
import { promoText } from './promoText'

const RAFF = {
  title: '',
  subtitle: null,
  terms: null,
  body:
    'После 17:00 сет из двух рафов со скидкой 30%. Закажите два любых рафа — скидка применится ' +
    'автоматически на оба напитка. Условия • Только раф (любой объём) • Минимум 2 рафа в одном заказе • ' +
    'Действует после 17:00 • Скидка применяется автоматически • Не суммируется с другими акциями',
}

describe('promoText', () => {
  it('заголовок — первое предложение, а не обрезанный по букве текст', () => {
    const t = promoText(RAFF)
    expect(t.title).toBe('После 17:00 сет из двух рафов со скидкой 30%')
    expect(t.title).not.toMatch(/…$/)
  })

  it('условия отделяются от описания и разбираются на пункты', () => {
    const t = promoText(RAFF)
    expect(t.lead).toBe('Закажите два любых рафа — скидка применится автоматически на оба напитка.')
    expect(t.terms).toEqual([
      'Только раф (любой объём)',
      'Минимум 2 рафа в одном заказе',
      'Действует после 17:00',
      'Скидка применяется автоматически',
      'Не суммируется с другими акциями',
    ])
  })

  it('заданный title и terms важнее разбора body', () => {
    const t = promoText({
      title: 'Вечерний сет',
      terms: 'Только раф • После 17:00',
      body: 'Описание акции.',
    })
    expect(t.title).toBe('Вечерний сет')
    expect(t.terms).toEqual(['Только раф', 'После 17:00'])
    expect(t.lead).toBe('Описание акции.')
  })

  it('переносы строк внутри условий тоже считаются пунктами', () => {
    const t = promoText({ body: 'Скидка на рафы.\nУсловия\nТолько раф\nМинимум 2 рафа' })
    expect(t.title).toBe('Скидка на рафы')
    expect(t.terms).toEqual(['Только раф', 'Минимум 2 рафа'])
  })

  it('пустая акция не роняет экран', () => {
    const t = promoText({ body: '', title: '', subtitle: null, terms: null })
    expect(t.title).toBe('Акция')
    expect(t.lead).toBe('')
    expect(t.terms).toEqual([])
  })

  it('длинное первое предложение режется по границе слова', () => {
    const long = `${'очень длинное описание акции '.repeat(6)}конец.`
    const t = promoText({ body: long })
    expect(t.title.endsWith('…')).toBe(true)
    expect(t.title.length).toBeLessThanOrEqual(66)
  })
})

import { describe, expect, it } from 'vitest'
import { createBody, draftError, draftFrom, emptyDraft, patchBody } from './voucherTemplates'

const base = { ...emptyDraft(), code: 'SUM10', title: 'Скидка 10%' }

describe('draftError', () => {
  it('пропускает корректный черновик', () => {
    expect(draftError(base)).toBeNull()
  })

  it('требует код только для нового шаблона', () => {
    expect(draftError({ ...base, code: '  ' })).toBe('Укажите код шаблона')
    const existing = { ...base, id: 5, code: '' }
    expect(draftError(existing)).toBeNull()
  })

  it('ловит процент > 100 и пустое название', () => {
    expect(draftError({ ...base, value: 120 })).toBe('Процент не может быть больше 100')
    expect(draftError({ ...base, title: ' ' })).toBe('Укажите название')
    // для суммы 120 допустима
    expect(draftError({ ...base, kind: 'fixed', value: 120 })).toBeNull()
  })

  it('проверяет срок, картинку и лимиты', () => {
    expect(draftError({ ...base, validDays: 0 })).toBe('Срок действия — минимум 1 день')
    expect(draftError({ ...base, imageUrl: 'javascript:alert(1)' })).toBe('Картинка: /uploads/… или https://…')
    expect(draftError({ ...base, imageUrl: '/uploads/v/1.png' })).toBeNull()
    expect(draftError({ ...base, maxPerDay: '0' })).toBe('Лимит в сутки — минимум 1')
    expect(draftError({ ...base, maxTotal: '-2' })).toBe('Общий лимит — минимум 1')
  })
})

describe('тело запроса', () => {
  it('create нормализует код и пустые значения', () => {
    const body = createBody({ ...base, code: ' sum10 ', title: ' Скидка 10% ', imageUrl: '  ' })
    expect(body.code).toBe('SUM10')
    expect(body.title).toBe('Скидка 10%')
    expect(body.imageUrl).toBeNull()
    expect(body.maxPerDay).toBeNull()
    expect(body.maxTotal).toBeNull()
    expect(body.redemptionMode).toBe('once')
    expect(body.active).toBe(true)
    expect(body.stackableWithFreeCup).toBe(true)
  })

  it('patch не отправляет код и сохраняет лимиты числами', () => {
    const p = patchBody({ ...base, maxPerDay: '2', maxTotal: '10', redemptionMode: 'multi' })
    expect('code' in p).toBe(false)
    expect(p.maxPerDay).toBe(2)
    expect(p.maxTotal).toBe(10)
    expect(p.redemptionMode).toBe('multi')
  })

  it('draftFrom восстанавливает черновик многоразового шаблона', () => {
    const d = draftFrom({
      id: 7, code: 'M', title: 'Многоразовый', kind: 'fixed', value: 300, validDays: 9,
      redemptionMode: 'multi', maxPerDay: 1, maxTotal: 5, stackableWithFreeCup: false, active: false,
    })
    expect(d).toMatchObject({
      id: 7, kind: 'fixed', redemptionMode: 'multi', maxPerDay: '1', maxTotal: '5',
      stackableWithFreeCup: false, active: false, imageUrl: '',
    })
  })
})

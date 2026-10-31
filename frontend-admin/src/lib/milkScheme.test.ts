import { describe, expect, it } from 'vitest'
import { milkDraftError, type MilkDraft } from './milkScheme'

const nameOf = (id: number | null) => (id == null ? undefined : { 1: 'Кокосовое молоко' }[id])

const draft = (over: Partial<MilkDraft> = {}): MilkDraft => ({
  name: 'Молоко',
  active: true,
  variants: [
    { productId: null, label: 'Обычное молоко', isDefault: true, isFree: true, sendToReceipt: false, sortOrder: 0, active: true },
    { productId: 1, label: 'Кокосовое молоко', isDefault: false, isFree: false, sendToReceipt: true, sortOrder: 1, active: true },
  ],
  ...over,
})

describe('milkDraftError', () => {
  it('корректная схема проходит', () => {
    expect(milkDraftError(draft(), nameOf)).toBeNull()
  })

  it('требует название и хотя бы один вариант', () => {
    expect(milkDraftError(draft({ name: ' ' }), nameOf)).toBe('Укажите название схемы')
    expect(milkDraftError(draft({ variants: [] }), nameOf)).toBe('Добавьте хотя бы один вариант молока')
  })

  it('запрещает два варианта по умолчанию', () => {
    const d = draft()
    d.variants[1].isDefault = true
    expect(milkDraftError(d, nameOf)).toMatch(/по умолчанию/)
  })

  it('бесплатный вариант не уходит в чек', () => {
    const d = draft()
    d.variants[0].sendToReceipt = true
    expect(milkDraftError(d, nameOf)).toMatch(/бесплатный/)
  })

  it('платному нужен товар, и товар должен существовать', () => {
    const noProduct = draft()
    noProduct.variants[1].productId = null
    expect(milkDraftError(noProduct, nameOf)).toMatch(/выберите товар/)
    const ghost = draft()
    ghost.variants[1].productId = 999
    expect(milkDraftError(ghost, nameOf)).toMatch(/не найден/)
  })

  it('один товар нельзя привязать к двум вариантам', () => {
    const d = draft()
    d.variants.push({ productId: 1, label: 'Второе', isDefault: false, isFree: false, sendToReceipt: true, sortOrder: 2, active: true })
    expect(milkDraftError(d, nameOf)).toMatch(/двум вариантам/)
  })
})

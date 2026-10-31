import { describe, expect, it } from 'vitest'
import { volumeDraftError, volumeDraftFrom } from './volumeScheme'

describe('volumeDraftFrom', () => {
  it('новая схема — три объёма по умолчанию', () => {
    const d = volumeDraftFrom()
    expect(d.id).toBeUndefined()
    expect(d.active).toBe(true)
    expect(d.items.map((i) => i.label)).toEqual(['200 мл', '300 мл', '400 мл'])
  })

  it('существующая схема копируется вместе с размерами', () => {
    const d = volumeDraftFrom({
      id: 7, name: 'Стандарт', active: false, usedByProducts: 2, createdAt: 1, updatedAt: 2,
      items: [{ id: 3, label: '250 мл', sizeValue: 250, sizeUnit: 'ml', sortOrder: 0, active: true }],
    })
    expect(d).toMatchObject({ id: 7, name: 'Стандарт', active: false })
    expect(d.items[0]).toMatchObject({ id: 3, label: '250 мл', sizeValue: 250, sizeUnit: 'ml' })
  })
})

describe('volumeDraftError', () => {
  it('корректная схема проходит', () => {
    expect(volumeDraftError({ ...volumeDraftFrom(), name: 'Стандарт' })).toBeNull()
  })

  it('без названия — ошибка', () => {
    expect(volumeDraftError({ name: '  ', active: true, items: [] })).toBe('Укажите название схемы')
  })

  it('без объёмов — ошибка', () => {
    expect(volumeDraftError({ name: 'Стандарт', active: true, items: [] })).toBe('Добавьте хотя бы один объём')
  })

  it('дубликаты объёмов запрещены (пробелы не спасают)', () => {
    const d = { ...volumeDraftFrom(), name: 'Стандарт' }
    d.items = [
      { label: '200 мл', sizeValue: 200, sizeUnit: 'ml', sortOrder: 0, active: true },
      { label: '200мл', sizeValue: 200, sizeUnit: 'ml', sortOrder: 1, active: true },
    ]
    expect(volumeDraftError(d)).toBe('Объём «200мл» указан дважды')
  })

  it('число без единицы — ошибка', () => {
    const d = { ...volumeDraftFrom(), name: 'Стандарт' }
    d.items = [{ label: '250', sizeValue: 250, sizeUnit: null, sortOrder: 0, active: true }]
    expect(volumeDraftError(d)).toBe('«250»: укажите и число, и единицу (мл/г)')
  })

  it('пустой лейбл — ошибка', () => {
    const d = { ...volumeDraftFrom(), name: 'Стандарт' }
    d.items = [{ label: ' ', sizeValue: null, sizeUnit: null, sortOrder: 0, active: true }]
    expect(volumeDraftError(d)).toBe('У каждого объёма должно быть название')
  })
})

import { describe, expect, it } from 'vitest'
import { DEACTIVATED_HINT, entityStatusLabel } from './format'

describe('entity status label (F-01)', () => {
  it('активная запись — «активен»', () => {
    expect(entityStatusLabel(1)).toEqual({ label: 'активен', tone: 'ok' })
    expect(entityStatusLabel(true)).toEqual({ label: 'активен', tone: 'ok' })
  })

  it('выключенная запись — «выключен», а не «удалён»', () => {
    expect(entityStatusLabel(0)).toEqual({ label: 'выключен', tone: 'neutral' })
    expect(entityStatusLabel(false)).toEqual({ label: 'выключен', tone: 'neutral' })
    expect(entityStatusLabel(null)).toEqual({ label: 'выключен', tone: 'neutral' })
    expect(entityStatusLabel(0).label).not.toMatch(/удал/i)
  })

  it('женский род для позиций склада', () => {
    expect(entityStatusLabel(0, 'f').label).toBe('выключена')
    expect(entityStatusLabel(1, 'f').label).toBe('активна')
  })

  it('подсказка объясняет, что запись сохранена', () => {
    expect(DEACTIVATED_HINT).toMatch(/история сохранена/i)
    expect(DEACTIVATED_HINT).not.toMatch(/^удалена?$/i)
  })
})

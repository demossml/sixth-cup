import { describe, expect, it } from 'vitest'

import { meterClick, meterMark, meterStart, meterTable } from './meter'

describe('meter — счётчик сценариев P1-31', () => {
  it('считает клики и промахи отдельно', () => {
    let s = meterStart(0)
    s = meterClick(s, true)
    s = meterClick(s, false)
    s = meterClick(s, true)
    expect(s.clicks).toBe(3)
    expect(s.misses).toBe(1)
  })

  it('таблица считает клики между метками, а не накопительно', () => {
    let s = meterStart(1000)
    s = meterClick(s, true)
    s = meterClick(s, true)
    s = meterMark(s, 'S1', 3000)
    s = meterClick(s, true)
    s = meterMark(s, 'S2', 5000)
    expect(meterTable(s)).toEqual([
      { label: 'S1', clicks: 2, misses: 0, ms: 2000 },
      { label: 'S2', clicks: 1, misses: 0, ms: 2000 },
    ])
  })

  it('первая метка считается от старта замера', () => {
    let s = meterStart(500)
    s = meterClick(s, false)
    s = meterMark(s, 'S1', 2500)
    expect(meterTable(s)[0]).toEqual({ label: 'S1', clicks: 1, misses: 1, ms: 2000 })
  })

  it('метка без действий даёт нули, а не отрицательные числа', () => {
    let s = meterStart(1000)
    s = meterMark(s, 'S1', 900) // часы «назад» — не должно ломать таблицу
    expect(meterTable(s)[0]).toMatchObject({ clicks: 0, misses: 0, ms: 0 })
  })

  it('две метки подряд: сценарий без кликов — это тоже результат', () => {
    let s = meterStart(0)
    s = meterMark(s, 'S1', 100)
    s = meterMark(s, 'S2', 200)
    expect(meterTable(s)).toEqual([
      { label: 'S1', clicks: 0, misses: 0, ms: 100 },
      { label: 'S2', clicks: 0, misses: 0, ms: 100 },
    ])
  })
})

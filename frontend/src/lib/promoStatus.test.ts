/**
 * Статус акции в списке «Акции» — на реальных данных прода (15.11.2026):
 *  • id 3 — «после 17:00» (17:00–23:00), в 16:03 ещё не началась;
 *  • id 1 — «до 12:00» (06:00–12:00), в 16:03 уже закончилась;
 *  • id 2 — видео без окна, действует всегда.
 */
import { describe, expect, it } from 'vitest'
import { daysLabel, promoStatus } from './promoStatus'

/** Локальное время → Date (часы/минуты в поясе машины, как в приложении). */
const at = (h: number, m = 0, dayOffset = 0) => {
  const d = new Date(2026, 10, 15, h, m, 0, 0) // 15.11.2026 — воскресенье
  d.setDate(d.getDate() + dayOffset)
  return d
}

describe('promoStatus', () => {
  it('акция «после 17:00» в 16:03 — ещё не началась', () => {
    const s = promoStatus({ from: 1020, to: 1380, daysMask: 127 }, at(16, 3))
    expect(s).toEqual({ visible: false, label: 'Начнётся в 17:00', upcoming: true })
  })

  it('акция «после 17:00» в 18:30 — действует', () => {
    expect(promoStatus({ from: 1020, to: 1380, daysMask: 127 }, at(18, 30)).visible).toBe(true)
  })

  it('акция «до 12:00» в 16:03 — завершилась', () => {
    expect(promoStatus({ from: 360, to: 720, daysMask: 127 }, at(16, 3))).toEqual({
      visible: false,
      label: 'Завершилась в 12:00',
      upcoming: false,
    })
  })

  it('без окна — действует всегда', () => {
    expect(promoStatus({ daysMask: 127 }, at(3, 0)).visible).toBe(true)
  })

  it('день недели не входит в маску — не «закончилась», а «только пн, вт»', () => {
    // 15.11.2026 — воскресенье (бит 6), маска только пн+вт (биты 0 и 1)
    const s = promoStatus({ from: 600, to: 720, daysMask: 0b0000011 }, at(11, 0))
    expect(s.visible).toBe(false)
    expect(s.label).toBe('Только пн, вт')
  })

  it('дата начала в будущем перекрывает окно времени', () => {
    const start = Math.floor(new Date(2026, 11, 1, 10, 0).getTime() / 1000)
    expect(promoStatus({ daysMask: 127, startsAt: start }, at(12, 0)).label).toBe('Начнётся 01.12')
  })

  it('истёкшая дата окончания — «Завершилась»', () => {
    const end = Math.floor(new Date(2026, 10, 1, 10, 0).getTime() / 1000)
    expect(promoStatus({ daysMask: 127, endsAt: end }, at(12, 0))).toEqual({
      visible: false,
      label: 'Завершилась',
      upcoming: false,
    })
  })

  it('окно через полночь: в 01:00 действует, в 15:00 начнётся в 22:00', () => {
    expect(promoStatus({ from: 1320, to: 120 }, at(1, 0)).visible).toBe(true)
    expect(promoStatus({ from: 1320, to: 120 }, at(15, 0)).label).toBe('Начнётся в 22:00')
  })

  it('поля из /api/directory (timeFrom/timeTo) понимаются так же', () => {
    // Ровно этот баг и был: список читал промо из каталога, где окно называется иначе,
    // и показывал «Сейчас действует» для акции, которая кончилась в 12:00.
    const ended = promoStatus({ timeFrom: 360, timeTo: 720, daysMask: 127 }, at(17, 17))
    expect(ended.visible).toBe(false)
    expect(ended.label).toBe('Завершилась в 12:00')
    const active = promoStatus({ timeFrom: 1020, timeTo: 1380, daysMask: 127 }, at(17, 17))
    expect(active.visible).toBe(true)
  })
})

describe('daysLabel', () => {
  it('пустая маска и 127 — без ограничения', () => {
    expect(daysLabel(null)).toBe('')
    expect(daysLabel(127)).toBe('')
  })

  it('выходные', () => {
    expect(daysLabel(0b1100000)).toBe('сб, вс')
  })
})

/**
 * Статус акции для списка «Акции»: главная скрывает акции вне окна (CON-1/CON-2),
 * а список показывал всё подряд — гость видел «после 17:00» в 16:03 без пометки.
 *
 * Здесь одна функция на всё: показывать/не показывать и что написать в подписи.
 * Время считается по часам телефона — работает и офлайн.
 */
import { isVisibleAt, isVisibleOnDay, minutesOf, weekdayIndex } from './dealWindow'

export type PromoWhen = {
  from?: number | null
  to?: number | null
  daysMask?: number | null
  /** Unix-время (сек) начала/конца периода публикации — даты, а не часы. */
  startsAt?: number | null
  endsAt?: number | null
}

export type PromoStatus = {
  /** Акция идёт прямо сейчас — карточку можно открыть и применить. */
  visible: boolean
  /** Человеческая подпись: «Сейчас действует», «Начнётся в 17:00», «Завершилась». */
  label: string
  /** Начнётся позже (время или дата) — рисуем приглушённо, но не «закончилась». */
  upcoming: boolean
}

const DAY_NAMES = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']

const hm = (v: number) => `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`

const ddmm = (sec: number) => {
  const d = new Date(sec * 1000)
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** «пн, вт, ср» — пустая строка, если ограничения по дням нет. */
export function daysLabel(mask?: number | null): string {
  if (mask == null || mask === 127) return ''
  if (mask <= 0) return 'выключена'
  return DAY_NAMES.filter((_, i) => (mask & (1 << i)) !== 0).join(', ')
}

export function promoStatus(when: PromoWhen, now: Date = new Date()): PromoStatus {
  const sec = Math.floor(now.getTime() / 1000)
  const minutes = minutesOf(now)
  const weekday = weekdayIndex(now)

  if (when.startsAt != null && sec < Number(when.startsAt)) {
    return { visible: false, label: `Начнётся ${ddmm(Number(when.startsAt))}`, upcoming: true }
  }
  if (when.endsAt != null && sec >= Number(when.endsAt)) {
    return { visible: false, label: 'Завершилась', upcoming: false }
  }
  if (!isVisibleOnDay(when.daysMask, weekday)) {
    const days = daysLabel(when.daysMask)
    return { visible: false, label: days === 'выключена' ? 'Не показывается' : `Только ${days}`, upcoming: true }
  }
  if (isVisibleAt({ from: when.from, to: when.to, daysMask: when.daysMask }, minutes, weekday)) {
    return { visible: true, label: 'Сейчас действует', upcoming: false }
  }

  const from = when.from ?? null
  const to = when.to ?? null
  // Окно ещё не открылось (в т.ч. окно через полночь: сейчас между `to` и `from`).
  if (from != null && minutes < from) {
    return { visible: false, label: `Начнётся в ${hm(from)}`, upcoming: true }
  }
  if (to != null) return { visible: false, label: `Завершилась в ${hm(to)}`, upcoming: false }
  return { visible: false, label: 'Сейчас не действует', upcoming: false }
}

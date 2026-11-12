/**
 * Окно показа акции по времени суток (CON-1) и дни недели (CON-2).
 *
 * Время приходит из админки в минутах от полуночи (420 = 07:00), дни — битовой
 * маской (бит 0 = понедельник … бит 6 = воскресенье). Считаем по часам телефона:
 * карточка появляется и исчезает без сети, из кэша каталога.
 *
 * Правила:
 *  • обе границы пустые — показываем всегда;
 *  • задано только начало — «с этого часа и до конца дня»;
 *  • задан только конец — «до этого часа»;
 *  • начало меньше конца — обычное окно [from, to);
 *  • начало больше конца — окно через полночь: [from, 24:00) + [00:00, to);
 *  • начало равно концу — считаем «весь день» (так проще пережить кривой ввод).
 *
 * Правила дней:
 *  • маска пустая (null) или 127 — все дни;
 *  • 0 — не показывать никогда (владелец снял все дни).
 */
export type ShowWindow = { from?: number | null; to?: number | null; daysMask?: number | null }

const DAY = 24 * 60
const ALL_DAYS = 127

export function minutesOf(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}

/** 0 = понедельник … 6 = воскресенье (в JS 0 = воскресенье, поэтому сдвигаем). */
export function weekdayIndex(date: Date): number {
  return (date.getDay() + 6) % 7
}

export function isVisibleOnDay(mask: number | null | undefined, weekday: number): boolean {
  if (mask == null || mask === ALL_DAYS) return true
  if (mask <= 0) return false
  return (mask & (1 << weekday)) !== 0
}

export function isVisibleAt(win: ShowWindow, minutes: number, weekday?: number): boolean {
  const from = win.from ?? null
  const to = win.to ?? null
  const m = ((Math.floor(minutes) % DAY) + DAY) % DAY

  const timeOk = (() => {
    if (from == null && to == null) return true
    if (from == null) return m < (to as number)
    if (to == null) return m >= from
    if (from === to) return true
    if (from < to) return m >= from && m < to
    // через полночь
    return m >= from || m < to
  })()

  if (!timeOk) return false
  if (weekday != null) return isVisibleOnDay(win.daysMask, weekday)
  return true
}

/** Человеческая подпись окна — для списков и отладки. */
export function windowLabel(win: ShowWindow): string {
  const from = win.from ?? null
  const to = win.to ?? null
  if (from == null && to == null) return 'весь день'
  const hm = (v: number) => `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`
  if (from == null) return `до ${hm(to as number)}`
  if (to == null) return `с ${hm(from)}`
  return `${hm(from)}–${hm(to)}`
}

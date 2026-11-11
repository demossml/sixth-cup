/**
 * P1-31: замер типовых сценариев «время и клики».
 *
 * Включается флагом `?meter=1` в адресе редактора. Пока флаг не задан, ни слушателей,
 * ни счётчиков нет — на обычную работу это не влияет.
 *
 * Что считается кликом: каждое нажатие указателя (`pointerdown`). Отдельно считаются
 * промахи — нажатия мимо интерактивного элемента (пользователь искал цель и не нашёл):
 * именно они превращают «5 кликов» в «15 кликов».
 *
 * Как пользуются: перед сценарием `__menuMeter.mark('S1')`, после — ещё одна метка.
 * Итог — `__menuMeter.table()`: «метка · клики · промахи · мс с прошлой метки».
 */

export type MeterMark = { label: string; at: number; clicks: number; misses: number }

export type MeterState = {
  startedAt: number
  clicks: number
  misses: number
  marks: MeterMark[]
}

export type MeterRow = { label: string; clicks: number; misses: number; ms: number }

export function meterStart(now: number): MeterState {
  return { startedAt: now, clicks: 0, misses: 0, marks: [] }
}

/** Нажатие указателя: `hit` — попал ли пользователь в интерактивный элемент. */
export function meterClick(state: MeterState, hit: boolean): MeterState {
  return { ...state, clicks: state.clicks + 1, misses: hit ? state.misses : state.misses + 1 }
}

export function meterMark(state: MeterState, label: string, now: number): MeterState {
  return { ...state, marks: [...state.marks, { label, at: now, clicks: state.clicks, misses: state.misses }] }
}

/**
 * Таблица сценариев: клики, промахи и время считаются между соседними метками,
 * первая метка — от старта замера.
 */
export function meterTable(state: MeterState): MeterRow[] {
  const rows: MeterRow[] = []
  let prevAt = state.startedAt
  let prevClicks = 0
  let prevMisses = 0
  for (const m of state.marks) {
    rows.push({
      label: m.label,
      clicks: m.clicks - prevClicks,
      misses: m.misses - prevMisses,
      ms: Math.max(0, Math.round(m.at - prevAt)),
    })
    prevAt = m.at
    prevClicks = m.clicks
    prevMisses = m.misses
  }
  return rows
}

/** Элементы, нажатие по которым — осмысленное действие. */
export const INTERACTIVE = 'button, a, input, select, textarea, label, [role="button"], [data-block-id], [contenteditable="true"]'

declare global {
  interface Window {
    __menuMeter?: {
      readonly state: MeterState
      mark: (label: string) => MeterState
      table: () => MeterRow[]
      reset: () => void
    }
  }
}

let installed = false

export function meterInit(): void {
  if (installed || typeof window === 'undefined') return
  if (!new URLSearchParams(window.location.search).has('meter')) return
  installed = true
  let state = meterStart(performance.now())
  window.__menuMeter = {
    get state() {
      return state
    },
    mark: (label: string) => {
      state = meterMark(state, label, performance.now())
      return state
    },
    table: () => meterTable(state),
    reset: () => {
      state = meterStart(performance.now())
    },
  }
  window.addEventListener(
    'pointerdown',
    (e) => {
      const target = e.target instanceof Element ? e.target : null
      state = meterClick(state, !!target?.closest(INTERACTIVE))
    },
    true,
  )
  console.info('[menu-meter] замер сценариев включён: __menuMeter.mark("S1") / __menuMeter.table()')
}

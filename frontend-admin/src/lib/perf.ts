/**
 * Замеры редактора макета: TTI, FPS при перетаскивании, время экспорта PDF.
 *
 * Включается флагом `?perf=1` в адресе страницы: в консоль пишется одна строка
 * с числами, а результаты копятся в `window.__menuPerf` — их видно из DevTools.
 * В обычной работе ничего не логируется и не влияет на скорость.
 */

type PerfState = {
  enabled: boolean
  startedAt: number
  ttiMs: number | null
  frames: number
  lastFps: number
  dragMs: number
  pdfMs: number[]
}

const state: PerfState = {
  enabled: false,
  startedAt: 0,
  ttiMs: null,
  frames: 0,
  lastFps: 0,
  dragMs: 0,
  pdfMs: [],
}

declare global {
  interface Window {
    __menuPerf?: PerfState
  }
}

let initialised = false

export function perfInit(): void {
  if (initialised) return
  initialised = true
  if (typeof window === 'undefined') return
  state.enabled = new URLSearchParams(window.location.search).has('perf')
  if (!state.enabled) return
  state.startedAt = performance.now()
  window.__menuPerf = state
  console.info('[menu-perf] замер включён, откройте редактор и подвигайте блок')
}

/** Вызывается, когда редактор впервые показал интерактивный лист. */
export function perfTTI(): void {
  if (!state.enabled || state.ttiMs != null) return
  // От старта редактора до первого интерактивного листа.
  state.ttiMs = Math.round(performance.now() - state.startedAt)
  console.info('[menu-perf] TTI редактора:', state.ttiMs, 'мс')
}

/** Кадр перетаскивания: считаем FPS на отрезке жеста. */
export function perfFrame(): void {
  if (!state.enabled) return
  state.frames += 1
}

export function perfDragStart(): void {
  if (!state.enabled) return
  state.frames = 0
  state.dragMs = performance.now()
}

export function perfDragEnd(): void {
  if (!state.enabled || !state.dragMs) return
  const ms = performance.now() - state.dragMs
  const fps = ms > 0 ? Math.round((state.frames / ms) * 1000) : 0
  state.lastFps = fps
  console.info('[menu-perf] FPS при перетаскивании:', fps, `(${state.frames} кадров за ${Math.round(ms)} мс)`)
  state.dragMs = 0
}

/** Время от клика «Скачать PDF» до готового файла. */
export function perfPdf(ms: number): void {
  if (!state.enabled) return
  state.pdfMs.push(Math.round(ms))
  console.info('[menu-perf] экспорт PDF:', Math.round(ms), 'мс')
}

export const perfSnapshot = (): PerfState => ({ ...state, pdfMs: [...state.pdfMs] })

import { docSnapshot, type MenuDoc } from './menuLayout'

/**
 * История документа: только снимки `doc_json`, без серверных полей.
 *
 * Правило: один шаг на жест. Перетаскивание двигает документ десятки раз за кадр,
 * но в историю попадает один снимок — тот, что был до начала жеста.
 */
export const HISTORY_LIMIT = 100

export type DocHistory = { past: MenuDoc[]; future: MenuDoc[] }

export const emptyHistory = (): DocHistory => ({ past: [], future: [] })

export const canUndo = (h: DocHistory): boolean => h.past.length > 0
export const canRedo = (h: DocHistory): boolean => h.future.length > 0

/** Запомнить состояние «до изменения». Новая правка обнуляет redo. */
export function pushHistory(history: DocHistory, previous: MenuDoc): DocHistory {
  return {
    past: [...history.past, docSnapshot(previous)].slice(-HISTORY_LIMIT),
    future: [],
  }
}

/** Шаг назад: возвращает документ «до» и переносит текущий в redo. */
export function undoStep(history: DocHistory, current: MenuDoc): { history: DocHistory; doc: MenuDoc } | null {
  const previous = history.past[history.past.length - 1]
  if (!previous) return null
  return {
    history: {
      past: history.past.slice(0, -1),
      future: [docSnapshot(current), ...history.future].slice(0, HISTORY_LIMIT),
    },
    doc: previous,
  }
}

/** Шаг вперёд по отменённым правкам. */
export function redoStep(history: DocHistory, current: MenuDoc): { history: DocHistory; doc: MenuDoc } | null {
  const next = history.future[0]
  if (!next) return null
  return {
    history: {
      past: [...history.past, docSnapshot(current)].slice(-HISTORY_LIMIT),
      future: history.future.slice(1),
    },
    doc: next,
  }
}

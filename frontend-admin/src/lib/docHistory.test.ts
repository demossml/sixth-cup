import { describe, expect, it } from 'vitest'
import { HISTORY_LIMIT, canRedo, canUndo, emptyHistory, pushHistory, redoStep, undoStep } from './docHistory'
import { newBlock, type MenuDoc } from './menuLayout'

const doc = (label: string): MenuDoc => ({
  pages: [{ id: 'page-1', blocks: [{ ...newBlock('text', { xPct: 0, yPct: 0, wPct: 10, hPct: 5 }), id: label, text: label }] }],
})
const label = (d: MenuDoc) => d.pages[0]!.blocks[0]!.id

describe('история документа', () => {
  it('пустая история ничего не отменяет', () => {
    const h = emptyHistory()
    expect(canUndo(h)).toBe(false)
    expect(canRedo(h)).toBe(false)
    expect(undoStep(h, doc('a'))).toBeNull()
    expect(redoStep(h, doc('a'))).toBeNull()
  })

  it('один шаг = одно действие, redo возвращает его обратно', () => {
    const a = doc('a')
    const b = doc('b')
    const h1 = pushHistory(emptyHistory(), a)
    const undone = undoStep(h1, b)!
    expect(label(undone.doc)).toBe('a')
    expect(canRedo(undone.history)).toBe(true)
    const redone = redoStep(undone.history, undone.doc)!
    expect(label(redone.doc)).toBe('b')
    expect(canUndo(redone.history)).toBe(true)
  })

  it('новая правка обнуляет redo', () => {
    const h = pushHistory(pushHistory(emptyHistory(), doc('a')), doc('b'))
    const undone = undoStep(h, doc('c'))!
    expect(canRedo(undone.history)).toBe(true)
    const afterNewEdit = pushHistory(undone.history, undone.doc)
    expect(canRedo(afterNewEdit)).toBe(false)
  })

  it('история не растёт бесконечно', () => {
    let h = emptyHistory()
    for (let i = 0; i < HISTORY_LIMIT + 25; i++) h = pushHistory(h, doc(`d${i}`))
    expect(h.past).toHaveLength(HISTORY_LIMIT)
    // самый старый снимок вытеснен, самый новый — на месте
    expect(label(h.past[h.past.length - 1]!)).toBe(`d${HISTORY_LIMIT + 24}`)
  })

  it('снимок не тащит серверные поля резолва', () => {
    const withResolve = doc('a')
    ;(withResolve.pages[0]!.blocks[0] as { warnings?: string[] }).warnings = ['нет цены']
    const h = pushHistory(emptyHistory(), withResolve)
    expect(h.past[0]!.pages[0]!.blocks[0]).not.toHaveProperty('warnings')
  })
})

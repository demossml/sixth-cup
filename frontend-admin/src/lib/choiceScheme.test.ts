import { describe, expect, it } from 'vitest'
import { choiceDraftError, choiceDraftFrom, type ChoiceDraft } from './choiceScheme'

const draft = (over: Partial<ChoiceDraft> = {}): ChoiceDraft => ({ ...choiceDraftFrom(), name: 'Корица', ...over })

describe('choiceDraftError', () => {
  it('черновик по умолчанию с названием проходит', () => {
    expect(choiceDraftError(draft())).toBeNull()
  })
  it('требует название и заголовок', () => {
    expect(choiceDraftError(draft({ name: ' ' }))).toMatch(/название схемы/)
    expect(choiceDraftError(draft({ title: '' }))).toMatch(/заголовок/i)
  })
  it('ограничивает длину подписей', () => {
    expect(choiceDraftError(draft({ title: 'x'.repeat(25) }))).toMatch(/24/)
    const d = draft(); d.options[0].label = 'y'.repeat(25)
    expect(choiceDraftError(d)).toMatch(/24/)
  })
  it('нужно два активных варианта', () => {
    const d = draft(); d.options[1].active = false
    expect(choiceDraftError(d)).toMatch(/два активных/)
  })
  it('повторы без учёта регистра запрещены', () => {
    const d = draft(); d.options[1].label = ' с КОРИЦЕЙ '
    expect(choiceDraftError(d)).toMatch(/повторяться/)
  })
  it('по умолчанию — не больше одного', () => {
    const d = draft(); d.options[0].isDefault = true; d.options[1].isDefault = true
    expect(choiceDraftError(d)).toMatch(/по умолчанию/)
  })
})

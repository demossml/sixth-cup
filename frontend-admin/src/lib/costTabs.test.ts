import { describe, expect, it } from 'vitest'
import { initialCostTab, shouldAutoFocusMissing } from './costTabs'

describe('initialCostTab', () => {
  it('старая ссылка ?focus=missing ведёт в «Ингредиенты»', () => {
    expect(initialCostTab('missing')).toBe('items')
    expect(initialCostTab('items')).toBe('items')
    expect(initialCostTab('fill')).toBe('items')
  })

  it('defaults to «Техкарты» without a focus parameter', () => {
    expect(initialCostTab(null)).toBe('tech')
    expect(initialCostTab('other')).toBe('tech')
  })

  it('«Сигналы» и «Сводка» открываются по параметру, старые рецепты ведут в «Техкарты»', () => {
    expect(initialCostTab('signals')).toBe('signals')
    expect(initialCostTab('summary')).toBe('summary')
    expect(initialCostTab('recipes')).toBe('tech')
  })
})

describe('shouldAutoFocusMissing', () => {
  const base = { focusMissing: false, userPicked: false, alreadyDone: false, hasData: true, missingCount: 2 }

  it('switches once when the dictionary has positions without a price', () => {
    expect(shouldAutoFocusMissing(base)).toBe(true)
  })

  it('never overrides an explicit user choice', () => {
    expect(shouldAutoFocusMissing({ ...base, userPicked: true })).toBe(false)
  })

  it('does not fire twice, without data, or with everything filled', () => {
    expect(shouldAutoFocusMissing({ ...base, alreadyDone: true })).toBe(false)
    expect(shouldAutoFocusMissing({ ...base, hasData: false })).toBe(false)
    expect(shouldAutoFocusMissing({ ...base, missingCount: 0 })).toBe(false)
  })

  it('is redundant when the link already opened «Дозаполнить»', () => {
    expect(shouldAutoFocusMissing({ ...base, focusMissing: true })).toBe(false)
  })
})

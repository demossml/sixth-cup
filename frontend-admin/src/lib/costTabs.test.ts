import { describe, expect, it } from 'vitest'
import { initialCostTab, shouldAutoFocusMissing } from './costTabs'

describe('initialCostTab', () => {
  it('opens «Дозаполнить» for ?focus=missing', () => {
    expect(initialCostTab('missing')).toBe('fill')
  })

  it('defaults to «Техкарты» without a focus parameter', () => {
    expect(initialCostTab(null)).toBe('tech')
    expect(initialCostTab('other')).toBe('tech')
  })

  it('opens «Сигналы» and старые вкладки по прямому параметру', () => {
    expect(initialCostTab('signals')).toBe('signals')
    expect(initialCostTab('recipes')).toBe('recipes')
    expect(initialCostTab('summary')).toBe('summary')
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

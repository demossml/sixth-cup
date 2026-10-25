import { describe, expect, it } from 'vitest'
import {
  ADDON_GROUPS_FALLBACK,
  defaultMaxCount,
  draftToOptions,
  normalizeGroupKey,
  requiredGroups,
  schemeToDraft,
} from './addonScheme'

describe('addon scheme editor: payload is the source of truth', () => {
  it('required survives save → load → save (R2)', () => {
    const fromApi = {
      options: [
        {
          id: 11, schemeId: 1, kind: 'zero' as const, productId: null, modifierId: null, name: 'Обычное',
          groupKey: 'milk', isDefault: true, required: true, maxCount: 1, priceOverride: null, sortOrder: 0,
        },
        {
          id: 12, schemeId: 1, kind: 'product' as const, productId: 7, modifierId: null, name: null,
          groupKey: 'milk', isDefault: false, required: false, maxCount: 1, priceOverride: null, sortOrder: 1,
        },
      ],
    }
    const first = draftToOptions(schemeToDraft(fromApi))
    expect(first[0].required).toBe(true)
    expect(first[1].required).toBe(false)

    // Второе сохранение без правок не должно терять required.
    const second = draftToOptions(schemeToDraft({ options: first }))
    expect(second).toEqual(first)
  })

  it('legacy items are read and converted to the options payload (R1)', () => {
    const options = draftToOptions(schemeToDraft({
      options: [],
      items: [
        { modifierId: 5, groupKey: 'topping', required: true, maxCount: 2 },
        { zeroOption: true, groupKey: 'milk', nameOverride: 'Обычное', isDefault: true },
      ],
    }))
    expect(options[0]).toMatchObject({ kind: 'modifier', modifierId: 5, groupKey: 'extra', required: true })
    expect(options[1]).toMatchObject({ kind: 'zero', name: 'Обычное', groupKey: 'milk', maxCount: 1 })
  })

  it('canonical group dictionary has sugar and folds topping/other into extra (R3)', () => {
    expect(ADDON_GROUPS_FALLBACK.map((g) => g.key)).toEqual(['milk', 'syrup', 'sugar', 'extra'])
    expect(normalizeGroupKey('sugar')).toBe('sugar')
    expect(normalizeGroupKey('сахар')).toBe('sugar')
    expect(normalizeGroupKey('topping')).toBe('extra')
    expect(normalizeGroupKey('other')).toBe('extra')
    expect(defaultMaxCount('extra')).toBe(2)
    expect(defaultMaxCount('sugar')).toBe(1)
  })

  it('badge lists only groups marked required', () => {
    expect(requiredGroups([
      { groupKey: 'milk', required: true },
      { groupKey: 'syrup', required: false },
      { groupKey: 'extra', required: 1 },
    ])).toEqual(['milk', 'extra'])
  })
})

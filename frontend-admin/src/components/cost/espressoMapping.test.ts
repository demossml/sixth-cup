import { describe, expect, it } from 'vitest'

import { applyEspressoChoiceToLines, isEspressoCardName, isEspressoName } from './espressoMapping'

describe('shared Espresso tech-card mapping', () => {
  it('recognizes English and Russian Espresso names', () => {
    expect(isEspressoName('Espresso')).toBe(true)
    expect(isEspressoName('Эспрессо')).toBe(true)
    expect(isEspressoName('Эспрессо (двойной)')).toBe(true)
    expect(isEspressoCardName('Эспрессо')).toBe(true)
    expect(isEspressoCardName('Эспрессо (двойной)')).toBe(false)
  })

  it('applies one selected tech card to every Espresso line and preserves quantities', () => {
    const firstRecipe = [
      { ingredientName: 'Espresso', choice: '', qty: 1, unit: 'pcs' },
      { ingredientName: 'Молоко', choice: 'stock:3', qty: 200, unit: 'ml' },
    ]
    const secondRecipe = [
      { ingredientName: 'эспрессо', choice: 'stock:4', qty: 2, unit: 'pcs' },
    ]

    expect(applyEspressoChoiceToLines(firstRecipe, 'semi:12')).toEqual([
      { ingredientName: 'Espresso', choice: 'semi:12', qty: 1, unit: 'pcs' },
      { ingredientName: 'Молоко', choice: 'stock:3', qty: 200, unit: 'ml' },
    ])
    expect(applyEspressoChoiceToLines(secondRecipe, 'semi:12')).toEqual([
      { ingredientName: 'эспрессо', choice: 'semi:12', qty: 2, unit: 'pcs' },
    ])
  })
})

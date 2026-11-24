import { describe, expect, it } from 'vitest'

import { applyStockItemChoiceToLines } from './stockItemMapping'

describe('shared stock-item mapping', () => {
  it('applies create or existing-item choice to matching ingredients across recipes', () => {
    const recipes = [
      { lines: [{ ingredientName: 'Сливки 10% Ёлка', unit: 'ml', choice: '' }] },
      { lines: [{ ingredientName: 'сливки 10 % елка', unit: 'ml', choice: 'new' }] },
      { lines: [{ ingredientName: 'Сливки 20% Ёлка', unit: 'ml', choice: '' }] },
      { lines: [{ ingredientName: 'Сливки 10% Ёлка', unit: 'g', choice: '' }] },
    ]

    const mapped = recipes.map((recipe) => ({
      ...recipe,
      lines: applyStockItemChoiceToLines(recipe.lines, 'Сливки 10% Ёлка', 'ml', 'new'),
    }))

    expect(mapped.map((recipe) => recipe.lines[0]!.choice)).toEqual(['new', 'new', '', ''])

    const linked = mapped.map((recipe) => ({
      ...recipe,
      lines: applyStockItemChoiceToLines(recipe.lines, 'Сливки 10% Ёлка', 'ml', 'stock:42'),
    }))
    expect(linked.map((recipe) => recipe.lines[0]!.choice)).toEqual(['stock:42', 'stock:42', '', ''])
  })

  it('does not apply an incomplete or skip choice', () => {
    const lines = [{ ingredientName: 'Сливки', unit: 'ml', choice: '' }]

    expect(applyStockItemChoiceToLines(lines, 'Сливки', null, 'new')).toBe(lines)
    expect(applyStockItemChoiceToLines(lines, 'Сливки', 'ml', 'skip')).toBe(lines)
  })
})

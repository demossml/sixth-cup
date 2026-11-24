type StockItemLine = {
  ingredientName: string
  unit: string | null
  choice: string
}

function normalizeIngredientName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function applyStockItemChoiceToLines<T extends StockItemLine>(
  lines: T[],
  ingredientName: string,
  unit: string | null,
  choice: string,
): T[] {
  if (!unit || (!choice.startsWith('stock:') && choice !== 'new')) return lines

  const nameKey = normalizeIngredientName(ingredientName)
  if (!nameKey) return lines

  return lines.map((line) =>
    line.unit === unit && normalizeIngredientName(line.ingredientName) === nameKey
      ? { ...line, choice }
      : line,
  )
}

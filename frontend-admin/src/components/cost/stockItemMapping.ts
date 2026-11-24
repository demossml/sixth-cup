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

export function stockItemMappingKey(name: string, unit: string | null): string | null {
  const nameKey = normalizeIngredientName(name)
  return nameKey ? `${unit ?? '?'}:${nameKey}` : null
}

export function applyStockItemChoiceToLines<T extends StockItemLine>(
  lines: T[],
  ingredientName: string,
  unit: string | null,
  choice: string,
): T[] {
  if (!unit || (!choice.startsWith('stock:') && choice !== 'new')) return lines

  const mappingKey = stockItemMappingKey(ingredientName, unit)
  if (!mappingKey) return lines

  return lines.map((line) =>
    stockItemMappingKey(line.ingredientName, line.unit) === mappingKey
      ? { ...line, choice }
      : line,
  )
}

export function applyStockItemPatchToLines<T extends StockItemLine>(
  lines: T[],
  ingredientName: string,
  unit: string | null,
  patch: Partial<T>,
): T[] {
  const mappingKey = stockItemMappingKey(ingredientName, unit)
  if (!mappingKey) return lines

  return lines.map((line) =>
    stockItemMappingKey(line.ingredientName, line.unit) === mappingKey &&
      line.choice === 'new'
      ? { ...line, ...patch }
      : line,
  )
}

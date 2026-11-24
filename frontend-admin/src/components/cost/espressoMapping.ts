function espressoNameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .trim()
    .split(/\s+/)
}

export function isEspressoName(name: string): boolean {
  return espressoNameTokens(name).some((token) => token === 'espresso' || token === 'эспрессо')
}

export function isEspressoCardName(name: string): boolean {
  const tokens = espressoNameTokens(name)
  return tokens.length === 1 && isEspressoName(name)
}

export function applyEspressoChoiceToLines<T extends { ingredientName: string; choice: string }>(
  lines: T[],
  choice: string,
): T[] {
  return lines.map((line) =>
    isEspressoName(line.ingredientName) ? Object.assign({}, line, { choice }) : line,
  )
}

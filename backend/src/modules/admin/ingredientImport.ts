import { resolveAiConfig } from '../../lib/aiSettings'

export type IngredientUnit = 'g' | 'ml' | 'pcs'
export type IngredientConfidence = 'high' | 'medium' | 'low'

export type IngredientImportCandidate = {
  name: string
  category: string
  unit: IngredientUnit | ''
  packQty: number | null
  packPriceRub: number | null
  orderQty: number | null
  confidence: IngredientConfidence
  sourceLine: string
  notes: string[]
}

const numberPattern = String.raw`(?:\d{1,3}(?:[ \u00a0]\d{3})+|\d+)(?:[.,]\d+)?`
const numberValue = (raw: string) => Number(raw.replace(/[ \u00a0]/g, '').replace(',', '.'))

function categoryOf(name: string): string {
  const value = name.toLowerCase()
  if (/молок|сливк|овсян|миндал|соев/.test(value)) return 'Молоко и альтернативы'
  if (/сироп|топпинг/.test(value)) return 'Сиропы и топпинги'
  if (/стакан|крышк|трубоч|салфет/.test(value)) return 'Посуда'
  if (/кофе|эспрессо|зерн|какао/.test(value)) return 'Кофе и зерно'
  if (/маршмел|кориц|спец|посып/.test(value)) return 'Специи и украшения'
  if (/хлеб|чиабат|индейк|сыр|салат|томат/.test(value)) return 'Еда / заготовки'
  return 'Прочее'
}

function stripRanges(source: string, ranges: { start: number; end: number }[]): string {
  let value = source
  for (const range of [...ranges].sort((a, b) => b.start - a.start)) {
    value = value.slice(0, range.start) + ' ' + value.slice(range.end)
  }
  return value
    .replace(/\s*[xх×*]\s*$/i, '')
    .replace(/\s*[-–—,:;]+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s\-–—,:;]+|[\s\-–—,:;]+$/g, '')
}

function parseLine(sourceLine: string): IngredientImportCandidate | null {
  const line = sourceLine.replace(/\s+/g, ' ').trim()
  if (!line) return null

  const priceRegex = new RegExp(
    `(${numberPattern})\\s*(?:₽|руб(?:л(?:ей|я)?|\\.?)?)(?![а-яёa-z])`,
    'i',
  )
  const priceMatch = priceRegex.exec(line)
  const packRegex = new RegExp(
    `(${numberPattern})\\s*(мл|ml|л|l|кг|kg|г|гр|g)(?![а-яёa-z])`,
    'i',
  )
  let packMatch = packRegex.exec(line)
  let inferredLitres = false
  if (!packMatch) {
    const barePackRegex = new RegExp(
      `(${numberPattern})\\s*(?=[-–—]\\s*${numberPattern}\\s*(?:шт\\.?|штук|уп(?:аковка)?|бут(?:ылок)?|pcs)\\s*[xх×*])`,
      'i',
    )
    packMatch = barePackRegex.exec(line)
    inferredLitres = packMatch != null && /сироп|соус|ликер|напит/i.test(line)
  }
  const orderRegex = new RegExp(
    `(${numberPattern})\\s*(шт\\.?|штук|уп(?:аковка)?|бут(?:ылок)?|pcs)(?:\\s*[xх×*]\\s*|\\s*[-–—]\\s*)?`,
    'i',
  )
  const orderMatch = orderRegex.exec(line)

  if (!priceMatch && !packMatch && !orderMatch) return null

  const notes: string[] = []
  let unit: IngredientUnit | '' = ''
  let packQty: number | null = null
  let confidence: IngredientConfidence = 'high'
  const unitRaw = packMatch?.[2]?.toLowerCase()
  const packNumber = packMatch ? numberValue(packMatch[1]) : null
  if (packMatch && packNumber != null && Number.isFinite(packNumber) && packNumber > 0) {
    if (inferredLitres || unitRaw === 'л' || unitRaw === 'l') {
      unit = 'ml'
      packQty = packNumber * 1000
      if (inferredLitres) {
        confidence = 'medium'
        notes.push(`Фасовка ${packMatch[1]} без единицы принята за литры (${packQty} мл)`)
      }
    } else if (unitRaw === 'кг' || unitRaw === 'kg') {
      unit = 'g'
      packQty = packNumber * 1000
    } else if (unitRaw === 'г' || unitRaw === 'гр' || unitRaw === 'g') {
      unit = 'g'
      packQty = packNumber
    } else {
      unit = 'ml'
      packQty = packNumber
    }
  }

  const orderQty = orderMatch ? numberValue(orderMatch[1]) : null
  const packPriceRub = priceMatch ? numberValue(priceMatch[1]) : null
  const ranges: { start: number; end: number }[] = []
  if (packMatch && packNumber != null) {
    ranges.push({ start: packMatch.index, end: packMatch.index + packMatch[0].length })
  }
  if (orderMatch) {
    ranges.push({ start: orderMatch.index, end: orderMatch.index + orderMatch[0].length })
  }
  if (priceMatch) {
    ranges.push({ start: priceMatch.index, end: priceMatch.index + priceMatch[0].length })
  }
  const name = stripRanges(line, ranges)
  if (name.length < 2) return null

  if (packQty == null) {
    confidence = 'low'
    notes.push('Не удалось определить фасовку одной упаковки')
  }
  if (packPriceRub == null) {
    confidence = 'low'
    notes.push('Не удалось определить цену одной упаковки')
  }
  if (packPriceRub != null && packPriceRub < 0) {
    confidence = 'low'
    notes.push('Цена должна быть неотрицательной')
  }

  return {
    name: name.slice(0, 120),
    category: categoryOf(name),
    unit,
    packQty,
    packPriceRub,
    orderQty: orderQty != null && Number.isFinite(orderQty) ? orderQty : null,
    confidence,
    sourceLine,
    notes,
  }
}

export function parseIngredientLines(text: string): IngredientImportCandidate[] {
  return text
    .split(/\r?\n/)
    .map((line) => parseLine(line))
    .filter((item): item is IngredientImportCandidate => item != null)
}

export function parseIngredientsFromText(text: string) {
  return parseIngredientLines(text).map((item) => ({
    name: item.name,
    category: item.category,
    unit: item.unit || 'pcs',
    packQty: item.packQty ?? 1,
    packPriceRub: item.packPriceRub,
    confidence: item.confidence === 'high' ? 'high' as const : 'low' as const,
    note: item.notes.join('; ') || undefined,
  }))
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function findSourceLine(lines: string[], proposed: string, name: string): string | null {
  const normalized = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim()
  const exact = lines.find((line) => normalized(line) === normalized(proposed))
  if (exact) return exact
  const nameKey = normalized(name)
  if (!nameKey) return null
  return lines.find((line) => normalized(line).includes(nameKey)) ?? null
}

function fromModel(value: unknown, sourceLines: string[]): IngredientImportCandidate | null {
  const row = toRecord(value)
  if (!row) return null
  const name = typeof row.name === 'string' ? row.name.trim().slice(0, 120) : ''
  const unitValue = row.unit
  const unit: IngredientImportCandidate['unit'] =
    unitValue === 'g' || unitValue === 'ml' || unitValue === 'pcs' ? unitValue : ''
  const packQty = typeof row.packQty === 'number' && Number.isFinite(row.packQty) && row.packQty > 0
    ? row.packQty
    : null
  const packPriceRub =
    typeof row.packPriceRub === 'number' && Number.isFinite(row.packPriceRub) && row.packPriceRub >= 0
      ? row.packPriceRub
      : null
  const orderQty =
    typeof row.orderQty === 'number' && Number.isFinite(row.orderQty) && row.orderQty > 0
      ? row.orderQty
      : null
  const confidence: IngredientConfidence =
    row.confidence === 'high' || row.confidence === 'medium' || row.confidence === 'low'
      ? row.confidence
      : 'low'
  const notes = Array.isArray(row.notes)
    ? row.notes.filter((note): note is string => typeof note === 'string').slice(0, 8)
    : typeof row.note === 'string'
      ? [row.note]
      : []
  const proposedLine = typeof row.sourceLine === 'string' ? row.sourceLine : ''
  const matchedLine = findSourceLine(sourceLines, proposedLine, name)
  const sourceLine = matchedLine ?? proposedLine
  if (!matchedLine) notes.push('Не удалось достоверно сопоставить результат с исходной строкой')
  if (!name) notes.push('Не распознано название')
  if (!unit) notes.push('Не распознана единица измерения')
  if (packQty == null) notes.push('Не распознана фасовка одной упаковки')
  if (packPriceRub == null) notes.push('Не распознана цена одной упаковки')
  return {
    name,
    category: typeof row.category === 'string' ? row.category.slice(0, 80) : categoryOf(name),
    unit,
    packQty,
    packPriceRub,
    orderQty,
    confidence,
    sourceLine,
    notes,
  }
}

function extractJson(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const source = fenced?.[1] ?? content
  const first = source.indexOf('{')
  const last = source.lastIndexOf('}')
  if (first < 0 || last <= first) throw new Error('ИИ вернул ответ без JSON-объекта')
  return JSON.parse(source.slice(first, last + 1)) as unknown
}

export async function parseIngredientImport(text: string): Promise<{
  items: IngredientImportCandidate[]
  provider: 'deepseek' | 'heuristic'
}> {
  const sourceLines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const cfg = resolveAiConfig()
  if (!cfg.enabled || !cfg.hasKey) {
    return { items: parseIngredientLines(text), provider: 'heuristic' }
  }

  const response = await fetch(cfg.baseUrl.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Извлеки только реальные товарные позиции из прайса/заказа. Ответ строго JSON {"items":[{"name":"...","category":"...","unit":"g|ml|pcs","packQty":число|null,"packPriceRub":число|null,"orderQty":число|null,"confidence":"high|medium|low","sourceLine":"точная исходная строка","notes":[]}]} ' +
            'packQty — количество базовых единиц в ОДНОЙ упаковке: литры переводи в миллилитры, кг в граммы. ' +
            'Не путай количество заказанных упаковок (orderQty) с фасовкой или ценой за упаковку. ' +
            'В строке «Сироп X 0,7 - 2 шт x 810 ₽» это 700 ml, orderQty 2, packPriceRub 810. ' +
            'Ничего не выдумывай: при отсутствии поля верни null и добавь note. sourceLine копируй дословно.',
        },
        { role: 'user', content: text },
      ],
    }),
    signal: AbortSignal.timeout(45000),
  })
  if (!response.ok) {
    const details = (await response.text()).slice(0, 300)
    throw new Error(`AI provider returned ${response.status}: ${details}`)
  }
  const payload = await response.json() as {
    choices?: { message?: { content?: string } }[]
  }
  const content = payload.choices?.[0]?.message?.content?.trim()
  if (!content) throw new Error('ИИ вернул пустой ответ')
  const decoded = extractJson(content)
  const rows = toRecord(decoded)?.items
  if (!Array.isArray(rows)) throw new Error('В ответе ИИ нет списка items')
  const items = rows
    .slice(0, 500)
    .map((row) => fromModel(row, sourceLines))
    .filter((item): item is IngredientImportCandidate => item != null)
  if (!items.length) throw new Error('ИИ не нашёл распознаваемых позиций')
  return { items, provider: 'deepseek' }
}

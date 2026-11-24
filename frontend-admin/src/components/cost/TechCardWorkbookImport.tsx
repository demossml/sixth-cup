import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileText, Plus, XCircle } from 'lucide-react'

import { api, uploadAdminFile } from '../../api/client'
import { costApi } from '../../lib/costApi'
import { UNIT_LABELS } from '../../lib/costMath'
import { Badge, Banner, Button, Card, Drawer, Field, Input, Select, Spinner, useToast } from '../../ui/kit'
import { applyEspressoChoiceToLines, isEspressoCardName, isEspressoName } from './espressoMapping'
import {
  applyStockItemChoiceToLines,
  applyStockItemPatchToLines,
  stockItemMappingKey,
} from './stockItemMapping'

type Unit = 'kg' | 'l' | 'g' | 'ml' | 'pcs'
type ImportUnit = 'g' | 'ml' | 'pcs'
type Match = { id: number; name: string; exact: boolean; score: number }
type CurrentLine = {
  lineId: number
  stockItemId: number | null
  childCardId: number | null
  name: string
  unit: Unit | null
  qtyBrutto: number
  lossColdPct: number
  lossHotPct: number
  qtyNetto: number | null
  qtyYield: number | null
  lineRole: 'base' | 'optional'
}
type ExistingLineDecision = {
  action: 'keep' | 'delete' | 'edit'
  lineId: number
  source: CurrentLine
  stockItemId: number | null
  childCardId: number | null
  name: string
  unit: Unit | null
  qtyBrutto: number
  lineRole: 'base' | 'optional'
}
type CardMatch = Match & {
  kind: 'dish' | 'semi' | 'modifier'
  productId: number | null
  currentVersionId: number | null
  currentLines: CurrentLine[]
}
type AutoMatchDecision = { id: number | null; confidence: 'high' | 'medium' | 'low'; reason: string }
type IngredientMatch = Match & {
  unit: Unit
  packageQty: number | null
  packagePriceRub: number | null
  hasCost: boolean
}
type SemiMatch = Match & { kind: 'dish' | 'semi' | 'modifier'; productId: number | null; outputUnit: Unit }
type PreviewLine = {
  sourceRow: number
  sourceText: string
  ingredientName: string
  qty: number | null
  unit: ImportUnit | null
  lineRole: 'base' | 'optional'
  issues: string[]
  matches: IngredientMatch[]
  semiMatches: SemiMatch[]
}
type PreviewRecipe = {
  key: string
  name: string
  baseName: string
  outputLabel: string | null
  sourceSheet: string
  sourceRow: number
  kind: 'dish' | 'semi'
  methodText: string | null
  lines: PreviewLine[]
  issues: string[]
  cardMatches: CardMatch[]
  productMatches: Match[]
}
type CatalogCard = {
  id: number
  name: string
  kind: 'dish' | 'semi' | 'modifier'
  productId: number | null
  outputUnit: Unit
  canBeChild: boolean
}
type Product = { id: number; name: string }
type StockItem = {
  id: number
  name: string
  unit: Unit
  packageQty: number | null
  packagePriceRub: number | null
  hasCost: boolean
}
type WorkbookPreview = {
  sourceName: string
  recipes: PreviewRecipe[]
  warnings: string[]
  autoMatches: {
    provider: 'deepseek' | 'heuristic'
    warning: string | null
    recipes: { key: string; card: AutoMatchDecision; product: AutoMatchDecision }[]
    lines: { recipeKey: string; lineIndex: number; stockItem: AutoMatchDecision; childCard: AutoMatchDecision }[]
  }
  stockItems: StockItem[]
  cards: CatalogCard[]
  products: Product[]
}
type LineDraft = PreviewLine & {
  choice: string
  newItemPackageQty: number | null
  newItemPackagePriceRub: number | null
}
type RecipeDraft = Omit<PreviewRecipe, 'lines'> & {
  action: string
  newCardKind: 'dish' | 'semi' | 'modifier' | ''
  productId: number | ''
  outputQty: number | null
  outputUnit: Unit | ''
  lines: LineDraft[]
  existingLineDecisions: Record<number, ExistingLineDecision[]>
}
type SavedCards = {
  applied: number
  productsCreated: number
  cards: { id: number; name: string; changeKind: 'created' | 'updated' }[]
}

const units: ImportUnit[] = ['g', 'ml', 'pcs']
const stockChoice = (id: number) => `stock:${id}`
const semiChoice = (id: number) => `semi:${id}`

function defaultLineChoice(line: PreviewLine, mapping: WorkbookPreview['autoMatches']['lines'][number] | undefined): string {
  if (isEspressoName(line.ingredientName)) {
    return mapping?.childCard.id != null ? semiChoice(mapping.childCard.id) : ''
  }
  if (mapping?.stockItem.id != null) return stockChoice(mapping.stockItem.id)
  if (mapping?.childCard.id != null) return semiChoice(mapping.childCard.id)
  return 'new'
}

function compositionDiff(recipe: RecipeDraft, current: CurrentLine[], preview: WorkbookPreview) {
  const unused = new Set(current.map((_, index) => index))
  const changes: { kind: 'added' | 'updated' | 'removed'; before?: CurrentLine; after?: LineDraft; currentIndex?: number }[] = []
  for (const line of recipe.lines.filter((candidate) => candidate.choice !== 'skip')) {
    const stockItemId = line.choice.startsWith('stock:') ? Number(line.choice.slice(6)) : null
    const childCardId = line.choice.startsWith('semi:') ? Number(line.choice.slice(5)) : null
    if (stockItemId == null && childCardId == null) {
      changes.push({ kind: 'added', after: line })
      continue
    }
    const matchIndex = current.findIndex((existing, index) =>
      unused.has(index) &&
      existing.stockItemId === stockItemId &&
      existing.childCardId === childCardId,
    )
    if (matchIndex < 0) {
      changes.push({ kind: 'added', after: line })
      continue
    }
    unused.delete(matchIndex)
    const before = current[matchIndex]!
    if (before.qtyBrutto !== line.qty || before.unit !== line.unit || before.lineRole !== line.lineRole) {
      changes.push({ kind: 'updated', before, after: line })
    }
  }
  for (const index of unused) changes.push({ kind: 'removed', before: current[index], currentIndex: index })
  return changes
}

function lineLabel(line: CurrentLine | LineDraft, preview: WorkbookPreview): string {
  if ('choice' in line) {
    if (line.choice.startsWith('stock:')) {
      return preview.stockItems.find((item) => item.id === Number(line.choice.slice(6)))?.name ?? line.ingredientName
    }
    if (line.choice.startsWith('semi:')) {
      const card = preview.cards.find((candidate) => candidate.id === Number(line.choice.slice(5)))
      return `${card?.kind === 'semi' ? 'Заготовка' : 'Техкарта'}: ${card?.name ?? line.ingredientName}`
    }
    return line.ingredientName
  }
  return line.name
}

function buildDrafts(preview: WorkbookPreview): RecipeDraft[] {
  const usedCardIds = new Set<number>()
  return preview.recipes.map((recipe) => {
    const autoMatch = preview.autoMatches.recipes.find((candidate) => candidate.key === recipe.key)
    const suggestedCardId = autoMatch?.card.id
    const cardId = suggestedCardId != null && !usedCardIds.has(suggestedCardId) ? suggestedCardId : null
    if (cardId != null) usedCardIds.add(cardId)
    const action = cardId == null ? 'create' : `card:${cardId}`
    const target = action.startsWith('card:') ? recipe.cardMatches.find((match) => match.id === Number(action.slice(5))) : undefined
    const parsedOutput = recipe.outputLabel?.match(/(\d+(?:[.,]\d+)?)\s*(мл|ml|л|l|г|гр|g|кг|kg|шт)?/i)
    const outputValue = parsedOutput ? Number(parsedOutput[1]!.replace(',', '.')) : null
    const outputRawUnit = parsedOutput?.[2]?.toLowerCase()
    const outputUnit: Unit = outputRawUnit === 'л' || outputRawUnit === 'l'
      ? 'ml'
      : outputRawUnit === 'кг' || outputRawUnit === 'kg'
        ? 'g'
        : outputRawUnit === 'г' || outputRawUnit === 'гр' || outputRawUnit === 'g'
          ? 'g'
          : outputRawUnit === 'мл' || outputRawUnit === 'ml'
            ? 'ml'
            : outputRawUnit?.startsWith('шт')
              ? 'pcs'
              : recipe.lines[0]?.unit ?? 'pcs'
    const outputQty = outputValue == null
      ? 1
      : outputUnit === 'ml' && (outputRawUnit === 'л' || outputRawUnit === 'l') ||
          outputUnit === 'g' && (outputRawUnit === 'кг' || outputRawUnit === 'kg')
        ? outputValue * 1000
        : outputValue
    return {
      ...recipe,
      action,
      newCardKind: recipe.kind,
      productId: target?.productId ?? autoMatch?.product.id ?? '',
      outputQty: recipe.kind === 'semi' ? outputQty : 1,
      outputUnit: recipe.kind === 'semi' ? outputUnit : 'pcs',
      lines: recipe.lines.map((line, lineIndex) => ({
        ...line,
        choice: defaultLineChoice(
          line,
          preview.autoMatches.lines.find((candidate) => candidate.recipeKey === recipe.key && candidate.lineIndex === lineIndex),
        ),
        newItemPackageQty: null,
        newItemPackagePriceRub: null,
      })),
      existingLineDecisions: Object.fromEntries(recipe.cardMatches.map((card) => [
        card.id,
        card.currentLines.map((line) => ({
          action: 'keep' as const,
          lineId: line.lineId,
          source: line,
          stockItemId: line.stockItemId,
          childCardId: line.childCardId,
          name: line.name,
          unit: line.unit,
          qtyBrutto: line.qtyBrutto,
          lineRole: line.lineRole,
        })),
      ])),
    }
  })
}

function recipeErrors(recipe: RecipeDraft, preview: WorkbookPreview): string[] {
  if (recipe.action === 'skip') return []
  const errors: string[] = []
  if (recipe.name.trim().length < 2) errors.push('Укажите название техкарты')
  if (recipe.action === 'create' && !recipe.newCardKind) errors.push('Укажите тип новой карты')
  if (recipe.action === 'create' && (!recipe.outputQty || recipe.outputQty <= 0 || !recipe.outputUnit)) {
    errors.push('Для новой карты укажите выход и единицу измерения')
  }
  const targetId = recipe.action.startsWith('card:') ? Number(recipe.action.slice(5)) : null
  const target = targetId == null ? null : preview.cards.find((card) => card.id === targetId)
  const targetMatch = targetId == null ? null : recipe.cardMatches.find((card) => card.id === targetId)
  const espressoCards = preview.cards.filter((card) => card.canBeChild && isEspressoCardName(card.name))
  for (const line of recipe.lines.filter((candidate) => isEspressoName(candidate.ingredientName))) {
    const selectedCard = line.choice.startsWith('semi:')
      ? preview.cards.find((card) => card.id === Number(line.choice.slice(5)))
      : undefined
    if (!espressoCards.length) {
      errors.push('Не найдена активная техкарта Espresso. Создайте или проверьте её перед импортом; строка не будет сохранена как складской ингредиент.')
    } else if (line.choice === 'skip') {
      errors.push('Строку Espresso нельзя пропустить: она должна ссылаться на существующую техкарту.')
    } else if (!selectedCard || !isEspressoCardName(selectedCard.name) || !selectedCard.canBeChild) {
      errors.push('Строку Espresso сопоставьте с существующей техкартой Espresso, а не со складским ингредиентом.')
    }
  }
  const selectedLines = recipe.lines.filter((line) => line.choice !== 'skip')
  if (!selectedLines.length) errors.push('Добавьте или выберите хотя бы один ингредиент')
  for (const [index, line] of selectedLines.entries()) {
    const label = `Строка ${index + 1}`
    if (line.ingredientName.trim().length < 2) errors.push(`${label}: укажите ингредиент`)
    if (!line.unit || !units.includes(line.unit)) errors.push(`${label}: подтвердите единицу измерения`)
    if (line.qty == null || !Number.isFinite(line.qty) || line.qty <= 0) errors.push(`${label}: укажите одно точное количество`)
    if (!line.choice) errors.push(`${label}: сопоставьте ингредиент или явно создайте новую позицию`)
    if (
      line.choice === 'new' &&
      line.newItemPackagePriceRub != null &&
      (line.newItemPackageQty == null || !Number.isFinite(line.newItemPackageQty) || line.newItemPackageQty <= 0)
    ) errors.push(`${label}: укажите количество упаковки, чтобы рассчитать введённую цену`)
    if (line.choice.startsWith('stock:')) {
      const item = preview.stockItems.find((candidate) => candidate.id === Number(line.choice.slice(6)))
      if (!item || item.unit !== line.unit) errors.push(`${label}: единица выбранного ингредиента не совпадает`)
    }
    if (line.choice.startsWith('semi:')) {
      const card = preview.cards.find((candidate) => candidate.id === Number(line.choice.slice(5)))
      if (!card || !card.canBeChild || card.outputUnit !== line.unit) errors.push(`${label}: единица выбранной техкарты не совпадает`)
    }
  }
  if (targetMatch) {
    const changes = compositionDiff(recipe, targetMatch.currentLines, preview)
    for (const change of changes) {
      if (change.kind !== 'removed' || change.currentIndex == null) continue
      const decision = recipe.existingLineDecisions[targetId!]?.[change.currentIndex]
      if (!decision) {
        errors.push(`Текущая строка «${change.before?.name ?? ''}»: выберите оставить, изменить или удалить`)
        continue
      }
      if (decision?.action !== 'edit') continue
      const label = `Текущая строка «${decision.source.name}»`
      if (!decision.name.trim() || !decision.unit || !Number.isFinite(decision.qtyBrutto) || decision.qtyBrutto <= 0) {
        errors.push(`${label}: укажите позицию и положительное количество`)
      }
      if ((decision.stockItemId == null) === (decision.childCardId == null)) {
        errors.push(`${label}: выберите одну складскую позицию или заготовку`)
      }
      if (decision.stockItemId != null) {
        const item = preview.stockItems.find((candidate) => candidate.id === decision.stockItemId)
        if (!item || item.unit !== decision.unit) errors.push(`${label}: выберите действующую позицию с совпадающей единицей`)
      }
      if (decision.childCardId != null) {
        const card = preview.cards.find((candidate) => candidate.id === decision.childCardId)
        if (!card || !card.canBeChild || card.outputUnit !== decision.unit) errors.push(`${label}: выберите техкарту с совпадающей единицей`)
      }
    }
  }
  return errors
}

export default function TechCardWorkbookImport({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: (result: SavedCards) => void
}) {
  const toast = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<WorkbookPreview | null>(null)
  const [recipes, setRecipes] = useState<RecipeDraft[]>([])
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState('')
  const [savingStockItemKey, setSavingStockItemKey] = useState<string | null>(null)

  const included = recipes.filter((recipe) => recipe.action !== 'skip')
  const espressoLineCount = recipes.reduce(
    (count, recipe) => count + recipe.lines.filter((line) => isEspressoName(line.ingredientName)).length,
    0,
  )
  const errors = useMemo(
    () => preview ? recipes.flatMap((recipe) => recipeErrors(recipe, preview).map((error) => `${recipe.name}: ${error}`)) : [],
    [recipes, preview],
  )
  const newItemPriceOwners = new Map<string, { recipeIndex: number; lineIndex: number }>()
  recipes.forEach((recipe, recipeIndex) => {
    recipe.lines.forEach((line, lineIndex) => {
      if (line.choice !== 'new') return
      const key = stockItemMappingKey(line.ingredientName, line.unit)
      if (key && !newItemPriceOwners.has(key)) newItemPriceOwners.set(key, { recipeIndex, lineIndex })
    })
  })
  const creationSummary = useMemo(() => {
    const positions = new Set<string>()
    const products = new Set<string>()
    let cards = 0
    let missingPrices = 0
    if (!preview) return { positions: 0, products: 0, cards: 0, missingPrices: 0 }
    for (const recipe of included) {
      const targetId = recipe.action.startsWith('card:') ? Number(recipe.action.slice(5)) : null
      const target = targetId == null ? null : preview.cards.find((card) => card.id === targetId)
      if (recipe.action === 'create') cards++
      const kind = target?.kind ?? (recipe.action === 'create' ? recipe.newCardKind : null)
      if (kind !== 'semi' && !recipe.productId && !target?.productId) {
        // «Капучино 300 мл» и «Капучино 400 мл» дадут один товар — цифры в названии карты это объём.
        products.add(recipe.name.toLowerCase().replace(/[^a-zа-я0-9]+/gi, ' ').replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim())
      }
      recipe.lines.forEach((line) => {
        if (line.choice !== 'new') {
          if (!line.choice.startsWith('stock:')) return
          const item = preview.stockItems.find((candidate) => candidate.id === Number(line.choice.slice(6)))
          if (item && !item.hasCost) missingPrices++
          return
        }
        const key = stockItemMappingKey(line.ingredientName, line.unit)
        if (key) positions.add(key)
        if (line.newItemPackagePriceRub == null) missingPrices++
      })
    }
    return { positions: positions.size, products: products.size, cards, missingPrices }
  }, [included, preview])

  const compositionSummary = useMemo(() => {
    const summary = { added: 0, changed: 0, kept: 0, deleted: 0 }
    if (!preview) return summary
    for (const recipe of included) {
      if (!recipe.action.startsWith('card:')) continue
      const cardId = Number(recipe.action.slice(5))
      const target = recipe.cardMatches.find((card) => card.id === cardId)
      if (!target) continue
      for (const change of compositionDiff(recipe, target.currentLines, preview)) {
        if (change.kind === 'added') summary.added++
        if (change.kind === 'updated') summary.changed++
        if (change.kind === 'removed' && change.currentIndex != null) {
          const decision = recipe.existingLineDecisions[cardId]?.[change.currentIndex]
          if (decision?.action === 'keep') summary.kept++
          if (decision?.action === 'delete') summary.deleted++
          if (decision?.action === 'edit') summary.changed++
        }
      }
    }
    return summary
  }, [included, preview])

  const parseFile = async () => {
    if (!file) return
    setBusy(true)
    setBusyLabel('Проверяю все листы Excel…')
    try {
      const parsed = await uploadAdminFile<WorkbookPreview>('/cost/tech-cards/import/preview', file)
      setPreview(parsed)
      setRecipes(buildDrafts(parsed))
      if (!parsed.recipes.length) toast.push('В книге не найдены техкарты', 'bad')
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Не удалось прочитать Excel', 'bad')
    } finally {
      setBusy(false)
      setBusyLabel('')
    }
  }

  const updateRecipe = (index: number, patch: Partial<RecipeDraft>) => {
    setRecipes((current) => current.map((recipe, i) => i === index ? { ...recipe, ...patch } : recipe))
  }

  const updateLine = (recipeIndex: number, lineIndex: number, patch: Partial<LineDraft>) => {
    setRecipes((current) => {
      const sourceLine = current[recipeIndex]?.lines[lineIndex]
      const choice = patch.choice
      const selectedCard = choice?.startsWith('semi:')
        ? preview?.cards.find((card) => card.id === Number(choice.slice(5)))
        : undefined
      const sharedEspressoChoice = sourceLine && isEspressoName(sourceLine.ingredientName) &&
        selectedCard?.canBeChild && isEspressoCardName(selectedCard.name)
        ? choice
        : undefined
      const sharedStockChoice = sourceLine &&
        !isEspressoName(sourceLine.ingredientName) &&
        (choice === 'new' || choice?.startsWith('stock:')) &&
        sourceLine.unit
        ? { name: sourceLine.ingredientName, unit: sourceLine.unit, choice }
        : undefined
      const sharedNewItemPrice = sourceLine &&
        sourceLine.choice === 'new' &&
        ('newItemPackageQty' in patch || 'newItemPackagePriceRub' in patch)
        ? { name: sourceLine.ingredientName, unit: sourceLine.unit }
        : undefined

      const updated = current.map((recipe, i) => ({
        ...recipe,
        lines: recipe.lines.map((line, j) => {
          if (i === recipeIndex && j === lineIndex) return { ...line, ...patch }
          return line
        }),
      }))
      if (sharedEspressoChoice) {
        return updated.map((recipe) => ({
          ...recipe,
          lines: applyEspressoChoiceToLines(recipe.lines, sharedEspressoChoice),
        }))
      }
      if (sharedStockChoice) {
        return updated.map((recipe) => ({
          ...recipe,
          lines: applyStockItemChoiceToLines(
            recipe.lines,
            sharedStockChoice.name,
            sharedStockChoice.unit,
            sharedStockChoice.choice,
          ),
        }))
      }
      if (sharedNewItemPrice) {
        return updated.map((recipe) => ({
          ...recipe,
          lines: applyStockItemPatchToLines(
            recipe.lines,
            sharedNewItemPrice.name,
            sharedNewItemPrice.unit,
            patch,
          ),
        }))
      }
      return updated
    })
  }

  const updateExistingLine = (
    recipeIndex: number,
    cardId: number,
    lineIndex: number,
    patch: Partial<ExistingLineDecision>,
  ) => {
    setRecipes((current) => current.map((recipe, i) => i !== recipeIndex
      ? recipe
      : {
          ...recipe,
          existingLineDecisions: {
            ...recipe.existingLineDecisions,
            [cardId]: recipe.existingLineDecisions[cardId]?.map((line, j) => j === lineIndex ? { ...line, ...patch } : line) ?? [],
          },
        }))
  }

  const saveNewStockItem = async (line: LineDraft) => {
    const mappingKey = stockItemMappingKey(line.ingredientName, line.unit)
    const unit = line.unit
    const name = line.ingredientName.trim()
    if (!mappingKey || !unit || name.length < 2) return
    const packageQty = line.newItemPackageQty != null && line.newItemPackageQty > 0 ? line.newItemPackageQty : 1
    const packagePriceRub = line.newItemPackagePriceRub != null && line.newItemPackagePriceRub >= 0
      ? line.newItemPackagePriceRub
      : 0

    setSavingStockItemKey(mappingKey)
    try {
      const created = await costApi.createItemWithPackage({
        name,
        unit,
        packageQty,
        packagePriceRub,
      })
      setPreview((current) => current ? {
        ...current,
        stockItems: [...current.stockItems, {
          id: created.id,
          name,
          unit,
          packageQty,
          packagePriceRub,
          hasCost: packagePriceRub > 0,
        }],
      } : current)
      setRecipes((current) => current.map((recipe) => ({
        ...recipe,
        lines: applyStockItemChoiceToLines(
          recipe.lines,
          name,
          unit,
          stockChoice(created.id),
        ),
      })))
      toast.push(`«${name}» сохранена на складе`, 'ok')
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Не удалось сохранить позицию склада', 'bad')
    } finally {
      setSavingStockItemKey(null)
    }
  }

  const save = async () => {
    if (!preview || !included.length || errors.length) return
    const targetIds = included.filter((recipe) => recipe.action.startsWith('card:')).map((recipe) => Number(recipe.action.slice(5)))
    if (new Set(targetIds).size !== targetIds.length) {
      toast.push('Одна техкарта выбрана для нескольких строк файла. Сопоставьте варианты отдельно.', 'bad')
      return
    }
    setBusy(true)
    try {
      const payload = {
        sourceName: preview.sourceName,
        recipes: included.map((recipe) => {
          const targetCardId = recipe.action.startsWith('card:') ? Number(recipe.action.slice(5)) : null
          const target = targetCardId == null ? null : preview.cards.find((card) => card.id === targetCardId)
          const targetMatch = targetCardId == null ? null : recipe.cardMatches.find((card) => card.id === targetCardId)
          const existingLines = targetCardId == null || !targetMatch
            ? []
            : compositionDiff(recipe, targetMatch.currentLines, preview)
              .filter((change) => change.kind === 'removed' && change.currentIndex != null)
              .map((change) => recipe.existingLineDecisions[targetCardId]?.[change.currentIndex!])
              .filter((decision): decision is ExistingLineDecision => Boolean(decision))
              .map((decision) => decision.action === 'edit'
                ? {
                    action: decision.action,
                    lineId: decision.lineId,
                    stockItemId: decision.stockItemId,
                    childCardId: decision.childCardId,
                    name: decision.name.trim(),
                    unit: decision.unit,
                    qtyBrutto: Number(decision.qtyBrutto),
                    lineRole: decision.lineRole,
                  }
                : { action: decision.action, lineId: decision.lineId })
          return {
            name: recipe.name.trim(),
            sourceSheet: recipe.sourceSheet,
            sourceRow: recipe.sourceRow,
            targetCardId,
            expectedVersionId: targetMatch?.currentVersionId ?? null,
            newCardKind: targetCardId == null ? recipe.newCardKind || null : null,
            productId: recipe.productId === '' ? target?.productId ?? null : Number(recipe.productId),
            outputQty: targetCardId == null ? recipe.outputQty : null,
            outputUnit: targetCardId == null ? recipe.outputUnit || null : null,
            methodText: recipe.methodText,
            existingLines,
            lines: recipe.lines
              .filter((line) => line.choice !== 'skip')
              .map((line) => {
                const stock = line.choice.startsWith('stock:') ? Number(line.choice.slice(6)) : null
                const semi = line.choice.startsWith('semi:') ? Number(line.choice.slice(5)) : null
                return {
                  stockItemId: stock,
                  childCardId: semi,
                  name: line.ingredientName.trim(),
                  unit: line.unit,
                  qty: Number(line.qty),
                  lineRole: line.lineRole,
                  ...(line.choice === 'new' ? {
                    newItemPackageQty: line.newItemPackageQty,
                    newItemPackagePriceRub: line.newItemPackagePriceRub,
                  } : {}),
                }
              }),
          }
        }),
      }
      const result = await api<SavedCards>('/cost/tech-cards/import/confirm', { method: 'POST', body: payload })
      onSaved(result)
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Не удалось сохранить техкарты', 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="Импорт техкарт из Excel"
      wide
      centered
      layer={75}
      footer={preview ? (
        <>
          <div className="mr-auto self-center text-xs text-ink-secondary">
            <div>К сохранению: {included.length} из {recipes.length}</div>
            <div>
              Состав: добавится {compositionSummary.added}, изменится {compositionSummary.changed},
              {' '}останется {compositionSummary.kept}, удалится {compositionSummary.deleted}
            </div>
            <div>
              Создастся: карт {creationSummary.cards}, товаров {creationSummary.products}, позиций склада {creationSummary.positions}
              {creationSummary.missingPrices > 0 ? `; без цены ${creationSummary.missingPrices}` : ''}
            </div>
          </div>
          <Button variant="ghost" disabled={busy} onClick={() => { setPreview(null); setRecipes([]) }}>Выбрать другой файл</Button>
          <Button
            disabled={busy || savingStockItemKey !== null || !included.length || errors.length > 0}
            loading={busy}
            onClick={() => void save()}
          >
            Сохранить всё и создать недостающее
          </Button>
        </>
      ) : (
        <>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button disabled={busy || !file} loading={busy} onClick={() => void parseFile()}>Разобрать все листы</Button>
        </>
      )}
    >
      {!preview ? (
        <div className="space-y-3">
          <Banner tone="warn">
            Файл сначала только анализируется. ИИ сама сопоставит карты, товары и ингредиенты; вы проверяете жёлтые строки и нажимаете «Сохранить всё и создать недостающее».
          </Banner>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-line p-4 text-sm hover:bg-surface-2">
            <FileText size={18} />
            {file?.name ?? 'Выбрать книгу XLSX или XLS'}
            <input
              type="file"
              className="sr-only"
              accept=".xlsx,.xls"
              disabled={busy}
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null
                if (selected && selected.size > 15 * 1024 * 1024) {
                  toast.push('Файл больше 15 МБ', 'bad')
                  event.currentTarget.value = ''
                  return
                }
                setFile(selected)
              }}
            />
          </label>
          {busy && <Spinner label={busyLabel || 'Читаю книгу…'} />}
        </div>
      ) : (
        <div className="space-y-3">
          <Banner tone="brand">
            {preview.sourceName}: листов обработано {new Set(preview.recipes.map((recipe) => recipe.sourceSheet)).size}, карт найдено {recipes.length}.
            {' '}
            {preview.autoMatches.provider === 'deepseek'
              ? 'ИИ сопоставила карты, товары и ингредиенты сама — проверьте только жёлтые строки.'
              : 'ИИ недоступна, сопоставление выполнено по названиям — проверьте жёлтые строки.'}
          </Banner>
          {preview.autoMatches.warning && <Banner tone="warn">{preview.autoMatches.warning}</Banner>}
          <Banner tone="brand">
            Будет создано автоматически: карт {creationSummary.cards}, товаров меню {creationSummary.products},
            {' '}складских позиций {creationSummary.positions}.
            {creationSummary.missingPrices > 0
              ? ` Без цены останется ${creationSummary.missingPrices}: они сохранятся с нулевой ценой и жёлтой отметкой — заполните позже в «Себестоимость → Ингредиенты».`
              : ' Все цены известны.'}
          </Banner>
          {preview.warnings.map((warning) => <Banner key={warning} tone="warn">{warning}</Banner>)}
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge tone="ok">Точное сопоставление</Badge>
            <Badge tone="warn">Проверьте похожее название</Badge>
            <Badge tone="bad">Не хватает обязательных данных</Badge>
          </div>
          {espressoLineCount > 0 && (
            <Banner tone="brand">
              Найдено строк Espresso: {espressoLineCount}. Техкарта Espresso подставляется автоматически во все строки; складской ингредиент Espresso не создаётся.
            </Banner>
          )}
          <Banner tone="brand">
            Одинаковые ингредиенты сводятся к одной складской позиции: выбор и цена применяются ко всем строкам с тем же названием и единицей измерения.
          </Banner>
          {errors.length > 0 && (
            <Banner tone="bad">
              Сохранение пока заблокировано: исправьте ошибки у включённых карт.
              <ul className="mt-1 list-disc pl-5">{errors.slice(0, 10).map((error) => <li key={error}>{error}</li>)}</ul>
            </Banner>
          )}
          {recipes.map((recipe, recipeIndex) => {
            const issues = recipeErrors(recipe, preview)
            const includedRow = recipe.action !== 'skip'
            const tone = !includedRow ? 'neutral' : issues.length ? 'bad' : 'ok'
            return (
              <Card key={recipe.key} className={`space-y-3 border p-3 ${tone === 'bad' ? 'border-red-300 bg-red-50/30' : tone === 'ok' ? 'border-green-200 bg-green-50/20' : 'border-line'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  {tone === 'bad' ? <XCircle size={16} className="text-bad" /> : tone === 'ok' ? <CheckCircle2 size={16} className="text-ok" /> : <AlertTriangle size={16} className="text-ink-tertiary" />}
                  <Badge tone={tone === 'neutral' ? 'neutral' : tone}>{tone === 'bad' ? 'Нужна проверка' : tone === 'ok' ? 'Готово к сохранению' : 'Пропущено'}</Badge>
                  <Badge tone="neutral">{recipe.sourceSheet}, строка {recipe.sourceRow}</Badge>
                  {recipe.action !== 'skip' && (() => {
                    const auto = preview.autoMatches.recipes.find((candidate) => candidate.key === recipe.key)
                    if (!auto) return null
                    return (
                      <Badge tone={auto.card.confidence === 'high' ? 'ok' : auto.card.confidence === 'medium' ? 'warn' : 'neutral'}>
                        ИИ: карта {auto.card.id == null ? 'будет создана' : auto.card.confidence === 'high' ? 'совпала' : 'похожа'}
                      </Badge>
                    )
                  })()}
                </div>
                {recipe.action !== 'skip' && (() => {
                  const auto = preview.autoMatches.recipes.find((candidate) => candidate.key === recipe.key)
                  if (!auto) return null
                  const messages = [
                    auto.card.id == null ? `Новая карта: ${auto.card.reason}` : auto.card.confidence === 'high' ? null : auto.card.reason,
                    auto.product.id == null && recipe.newCardKind !== 'semi' ? 'Товар меню будет создан с нулевой ценой — заполните позже в «Меню → Товары».' : auto.product.reason,
                  ].filter((message): message is string => Boolean(message))
                  if (!messages.length) return null
                  const uncertain = auto.card.confidence !== 'high' || auto.product.confidence !== 'high'
                  return (
                    <Banner tone={uncertain ? 'warn' : 'brand'}>
                      {messages.join(' ')}
                    </Banner>
                  )
                })()}
                <div className="grid gap-2 lg:grid-cols-3">
                  <Field label="Название в файле">
                    <Input value={recipe.name} onChange={(event) => updateRecipe(recipeIndex, { name: event.target.value })} />
                  </Field>
                  <Field label="Сопоставить техкарту">
                    <Select value={recipe.action} onChange={(event) => updateRecipe(recipeIndex, {
                      action: event.target.value,
                      productId: event.target.value.startsWith('card:')
                        ? preview.cards.find((card) => card.id === Number(event.target.value.slice(5)))?.productId ?? ''
                        : '',
                    })}>
                      <option value="skip">Не импортировать эту карту</option>
                      {recipe.cardMatches.map((match) => (
                        <option key={match.id} value={`card:${match.id}`}>
                          {match.exact ? 'Точное совпадение: ' : 'Похожее: '}{match.name} ({match.kind})
                        </option>
                      ))}
                      <option value="create">Создать новую карту</option>
                    </Select>
                  </Field>
                  {recipe.action === 'create' ? (
                    <Field label="Тип новой карты">
                      <Select value={recipe.newCardKind} onChange={(event) => {
                        const nextKind = event.target.value as RecipeDraft['newCardKind']
                        updateRecipe(recipeIndex, {
                          newCardKind: nextKind,
                          outputQty: nextKind === 'semi' ? null : 1,
                          outputUnit: nextKind === 'semi' ? '' : 'pcs',
                        })
                      }}>
                        <option value="">— выберите тип —</option>
                        <option value="dish">Блюдо</option>
                        <option value="semi">Заготовка</option>
                        <option value="modifier">Модификатор</option>
                      </Select>
                    </Field>
                  ) : null}
                </div>
                {recipe.action === 'create' && recipe.newCardKind === 'semi' && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="Выход заготовки" hint="Не выводится из списка ингредиентов: укажите фактический выход партии.">
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value={recipe.outputQty ?? ''}
                        onChange={(event) => updateRecipe(recipeIndex, { outputQty: event.target.value ? Number(event.target.value) : null })}
                      />
                    </Field>
                    <Field label="Единица выхода">
                      <Select
                        value={recipe.outputUnit}
                        onChange={(event) => updateRecipe(recipeIndex, { outputUnit: event.target.value as Unit | '' })}
                      >
                        <option value="">— выбрать —</option>
                        {(['kg', 'g', 'l', 'ml', 'pcs'] as Unit[]).map((unit) => (
                          <option key={unit} value={unit}>{UNIT_LABELS[unit]}</option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                )}
                {(() => {
                  const targetId = recipe.action.startsWith('card:') ? Number(recipe.action.slice(5)) : null
                  const target = targetId == null ? null : preview.cards.find((card) => card.id === targetId)
                  const kind = target?.kind ?? (recipe.action === 'create' ? recipe.newCardKind : '')
                  return recipe.action !== 'skip' && kind !== 'semi' ? (
                    <Field
                      label="Товар каталога"
                      hint={recipe.productId === '' && !target?.productId
                        ? 'Товар не выбран — он создастся автоматически с нулевой ценой.'
                        : 'Связь влияет на фудкост и продажи: проверьте, если название в каталоге похожее.'}
                    >
                      <Select value={recipe.productId} onChange={(event) => updateRecipe(recipeIndex, { productId: event.target.value ? Number(event.target.value) : '' })}>
                        <option value="">— выберите товар —</option>
                        {preview.products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                      </Select>
                    </Field>
                  ) : null
                })()}
                {recipe.issues.map((issue) => <Banner key={issue} tone="warn">{issue}</Banner>)}
                {recipe.action.startsWith('card:') && (() => {
                  const targetId = Number(recipe.action.slice(5))
                  const target = recipe.cardMatches.find((match) => match.id === targetId)
                  if (!target) return null
                  const changes = compositionDiff(recipe, target.currentLines, preview)
                  return (
                    <Card className="space-y-2 border border-line p-3">
                      <div className="text-sm font-semibold">Сравнение с текущей картой «{target.name}»</div>
                      {changes.length === 0 ? (
                        <div className="text-sm text-ok">Состав совпадает с файлом — изменений строк нет.</div>
                      ) : changes.map((change, index) => {
                        if (change.kind !== 'removed' || change.currentIndex == null) {
                          return (
                            <div
                              key={`${change.kind}-${index}`}
                              className={`rounded-lg px-2 py-1.5 text-sm ${change.kind === 'added' ? 'bg-green-50 text-green-900' : 'bg-amber-50 text-amber-900'}`}
                            >
                              {change.kind === 'added' && <>Добавится: {lineLabel(change.after!, preview)} — {change.after!.qty ?? 'не указано'} {UNIT_LABELS[change.after!.unit ?? '']}</>}
                              {change.kind === 'updated' && <>Изменится: {lineLabel(change.before!, preview)} {change.before!.qtyBrutto} → {change.after!.qty} {UNIT_LABELS[change.after!.unit ?? '']}</>}
                            </div>
                          )
                        }

                        const decision = recipe.existingLineDecisions[targetId]?.[change.currentIndex]
                        if (!decision) return null
                        const tone = decision.action === 'keep'
                          ? 'border-green-200 bg-green-50/60'
                          : decision.action === 'delete'
                            ? 'border-red-300 bg-red-50/60'
                            : 'border-amber-300 bg-amber-50/60'
                        const selectedChoice = decision.stockItemId != null
                          ? stockChoice(decision.stockItemId)
                          : decision.childCardId != null
                            ? semiChoice(decision.childCardId)
                            : ''
                        const selectedItemExists = decision.stockItemId != null && preview.stockItems.some((item) => item.id === decision.stockItemId)
                        const selectedCardExists = decision.childCardId != null && preview.cards.some((card) => card.id === decision.childCardId && card.canBeChild)

                        return (
                          <div key={`missing-${decision.lineId}`} className={`space-y-2 rounded-lg border p-3 ${tone}`}>
                            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-center">
                              <div className="min-w-0 text-sm">
                                <div className="font-medium">В Excel нет: {decision.source.name}</div>
                                <div className="text-xs text-ink-secondary">
                                  Текущее значение: {decision.source.qtyBrutto} {UNIT_LABELS[decision.source.unit ?? '']}; роль: {decision.source.lineRole === 'optional' ? 'опциональная' : 'обязательная'}
                                </div>
                              </div>
                              <Field label="Действие">
                                <Select
                                  value={decision.action}
                                  onChange={(event) => updateExistingLine(recipeIndex, targetId, change.currentIndex!, {
                                    action: event.target.value as ExistingLineDecision['action'],
                                  })}
                                >
                                  <option value="keep">Оставить как есть</option>
                                  <option value="delete">Удалить при сохранении</option>
                                  <option value="edit">Изменить строку</option>
                                </Select>
                              </Field>
                            </div>
                            {decision.action === 'keep' && (
                              <div className="text-sm font-medium text-green-900">
                                Останется в новой версии без изменений.
                              </div>
                            )}
                            {decision.action === 'delete' && (
                              <div className="text-sm font-medium text-red-900">
                                Будет удалено только после нажатия «Сохранить всё и создать недостающее».
                              </div>
                            )}
                            {decision.action === 'edit' && (
                              <div className="grid gap-2 sm:grid-cols-3">
                                <Field label="Ингредиент или заготовка">
                                  <Select
                                    value={selectedChoice}
                                    onChange={(event) => {
                                      const choice = event.target.value
                                      if (choice.startsWith('stock:')) {
                                        const item = preview.stockItems.find((candidate) => candidate.id === Number(choice.slice(6)))
                                        if (item) updateExistingLine(recipeIndex, targetId, change.currentIndex!, {
                                          stockItemId: item.id,
                                          childCardId: null,
                                          name: item.name,
                                          unit: item.unit,
                                        })
                                      } else if (choice.startsWith('semi:')) {
                                        const card = preview.cards.find((candidate) => candidate.id === Number(choice.slice(5)))
                                        if (card?.canBeChild) updateExistingLine(recipeIndex, targetId, change.currentIndex!, {
                                          stockItemId: null,
                                          childCardId: card.id,
                                          name: card.name,
                                          unit: card.outputUnit ?? null,
                                        })
                                      }
                                    }}
                                  >
                                    {!selectedChoice && <option value="">— выберите позицию —</option>}
                                    {decision.stockItemId != null && !selectedItemExists && (
                                      <option value={selectedChoice} disabled>{decision.name} · недоступен</option>
                                    )}
                                    {decision.childCardId != null && !selectedCardExists && (
                                      <option value={selectedChoice} disabled>{decision.name} · техкарта недоступна</option>
                                    )}
                                    {preview.stockItems.map((item) => (
                                      <option key={`stock-${item.id}`} value={stockChoice(item.id)}>
                                        {item.name} ({UNIT_LABELS[item.unit]})
                                      </option>
                                    ))}
                                    {preview.cards.filter((card) => card.canBeChild).map((card) => (
                                      <option key={`semi-${card.id}`} value={semiChoice(card.id)}>
                                        {card.kind === 'semi' ? 'Заготовка' : 'Техкарта'}: {card.name} ({UNIT_LABELS[card.outputUnit]})
                                      </option>
                                    ))}
                                  </Select>
                                </Field>
                                <Field label={`Количество${decision.unit ? `, ${UNIT_LABELS[decision.unit]}` : ''}`}>
                                  <Input
                                    type="number"
                                    min="0"
                                    step="any"
                                    value={decision.qtyBrutto}
                                    onChange={(event) => updateExistingLine(recipeIndex, targetId, change.currentIndex!, {
                                      qtyBrutto: event.target.value ? Number(event.target.value) : 0,
                                    })}
                                  />
                                </Field>
                                <Field label="Роль строки">
                                  <Select
                                    value={decision.lineRole}
                                    onChange={(event) => updateExistingLine(recipeIndex, targetId, change.currentIndex!, {
                                      lineRole: event.target.value as CurrentLine['lineRole'],
                                    })}
                                  >
                                    <option value="base">Обязательная</option>
                                    <option value="optional">Опциональная</option>
                                  </Select>
                                </Field>
                              </div>
                            )}
                          </div>
                        )
                      })}
                      {changes.some((change) => change.kind === 'removed') && (
                        <Banner tone="warn">Строки, которых нет в Excel, по умолчанию останутся в карте. Для каждой строки выберите: оставить, удалить или изменить.</Banner>
                      )}
                    </Card>
                  )
                })()}
                {!recipe.cardMatches.some((match) => match.exact) && recipe.cardMatches.length > 0 && recipe.action !== 'skip' && (
                  <Banner tone="warn">Есть похожие техкарты, но совпадение не точное. Проверьте выбранную карту или создайте новую.</Banner>
                )}
                {recipe.action !== 'skip' && (
                  <>
                    <Field label="Способ приготовления">
                      <textarea
                        className="min-h-16 w-full rounded-xl border border-line p-2 text-sm"
                        value={recipe.methodText ?? ''}
                        onChange={(event) => updateRecipe(recipeIndex, { methodText: event.target.value || null })}
                      />
                    </Field>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">Состав из Excel — сверка со складом и техкартами</span>
                        <Button variant="secondary" onClick={() => updateRecipe(recipeIndex, { lines: [...recipe.lines, {
                          sourceRow: recipe.sourceRow,
                          sourceText: 'Добавлено вручную',
                          ingredientName: '',
                          qty: null,
                          unit: null,
                          lineRole: 'base',
                          issues: [],
                          matches: [],
                          semiMatches: [],
                          choice: '',
                          newItemPackageQty: null,
                          newItemPackagePriceRub: null,
                        }] })}>
                          <Plus size={14} /> Строка
                        </Button>
                      </div>
                      {recipe.lines.map((line, lineIndex) => {
                        const espressoLine = isEspressoName(line.ingredientName)
                        const selectedItem = line.choice.startsWith('stock:') ? preview.stockItems.find((item) => item.id === Number(line.choice.slice(6))) : null
                        const selectedSemi = line.choice.startsWith('semi:') ? preview.cards.find((card) => card.id === Number(line.choice.slice(5))) : null
                        const invalidEspressoLink = isEspressoName(line.ingredientName) && (
                          !selectedSemi ||
                          !selectedSemi.canBeChild ||
                          !isEspressoCardName(selectedSemi.name) ||
                          selectedSemi.outputUnit !== line.unit
                        )
                        const lineError = (line.choice !== 'skip' && (!line.ingredientName.trim() || !line.unit || !line.qty || line.qty <= 0 || (selectedItem && selectedItem.unit !== line.unit) || (selectedSemi && (!selectedSemi.canBeChild || selectedSemi.outputUnit !== line.unit)))) || invalidEspressoLink
                        const autoLine = preview.autoMatches.lines.find((candidate) => candidate.recipeKey === recipe.key && candidate.lineIndex === lineIndex)
                        const autoDecision = espressoLine ? autoLine?.childCard : autoLine?.stockItem ?? autoLine?.childCard
                        const needsPrice = line.choice === 'new'
                          ? line.newItemPackagePriceRub == null
                          : Boolean(selectedItem && !selectedItem.hasCost)
                        const matchReason = autoDecision && autoDecision.confidence !== 'high' && line.choice !== 'skip'
                          ? autoDecision.reason
                          : null
                        const newItemKey = stockItemMappingKey(line.ingredientName, line.unit)
                        const priceOwner = newItemKey ? newItemPriceOwners.get(newItemKey) : undefined
                        const showNewItemPrice = line.choice === 'new' &&
                          priceOwner != null &&
                          priceOwner.recipeIndex === recipeIndex &&
                          priceOwner.lineIndex === lineIndex
                        return (
                          <div key={`${line.sourceRow}-${lineIndex}`} className={`rounded-xl border p-2 ${lineError ? 'border-red-300 bg-red-50/30' : needsPrice || matchReason ? 'border-amber-300 bg-amber-50/40' : 'border-line'}`}>
                            <div className="mb-2 flex items-center gap-2 text-xs text-ink-secondary">
                              <span className="font-medium">Excel, строка {line.sourceRow}:</span>
                              <span className="break-all">{line.sourceText}</span>
                              {line.issues.map((issue) => <span key={issue} className="text-bad">{issue}</span>)}
                            </div>
                            {(needsPrice || matchReason) && (
                              <div className="mb-2 space-y-1 text-xs text-amber-900">
                                {needsPrice && (
                                  <p>
                                    {line.choice === 'new'
                                      ? 'Цена не указана — позиция сохранится с нулевой ценой. Впишите цену упаковки здесь или заполните позже в «Себестоимость → Ингредиенты».'
                                      : 'У этой складской позиции нет цены — себестоимость останется нулевой до заполнения.'}
                                  </p>
                                )}
                                {matchReason && <p>{matchReason}</p>}
                              </div>
                            )}
                            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                              <Field label="Ингредиент или техкарта">
                                <Input value={line.ingredientName} onChange={(event) => updateLine(recipeIndex, lineIndex, { ingredientName: event.target.value })} />
                              </Field>
                              <Field label="Количество">
                                <Input type="number" min="0" step="any" value={line.qty ?? ''} onChange={(event) => updateLine(recipeIndex, lineIndex, { qty: event.target.value ? Number(event.target.value) : null })} />
                              </Field>
                              <Field label="Единица">
                                <Select value={line.unit ?? ''} onChange={(event) => updateLine(recipeIndex, lineIndex, { unit: event.target.value ? event.target.value as ImportUnit : null })}>
                                  <option value="">— выбрать —</option>
                                  {units.map((unit) => <option key={unit} value={unit}>{UNIT_LABELS[unit]}</option>)}
                                </Select>
                              </Field>
                              <Field label="Сопоставление">
                                <Select value={line.choice} onChange={(event) => updateLine(recipeIndex, lineIndex, { choice: event.target.value })}>
                                  <option value="">{espressoLine ? '— выберите существующую техкарту Espresso —' : '— выберите вручную —'}</option>
                                  {!espressoLine && <option value="new">Создать позицию склада</option>}
                                  {!espressoLine && preview.stockItems.map((item) => (
                                    <option key={`stock-${item.id}`} value={stockChoice(item.id)} disabled={item.unit !== line.unit}>
                                      {item.name} ({UNIT_LABELS[item.unit]}){line.matches.some((match) => match.id === item.id && match.exact) ? ' · точное' : ''}
                                    </option>
                                  ))}
                                  {preview.cards.filter((card) => card.canBeChild && (!espressoLine || isEspressoCardName(card.name))).map((card) => (
                                    <option key={`semi-${card.id}`} value={semiChoice(card.id)} disabled={card.outputUnit !== line.unit}>
                                      {card.kind === 'semi' ? 'Заготовка' : 'Техкарта'}: {card.name} ({UNIT_LABELS[card.outputUnit]})
                                    </option>
                                  ))}
                                  {!espressoLine && <option value="skip">Не включать эту строку</option>}
                                </Select>
                              </Field>
                              <Field label="Вклад в техкарту">
                                <Select value={line.lineRole} onChange={(event) => updateLine(recipeIndex, lineIndex, { lineRole: event.target.value as PreviewLine['lineRole'] })}>
                                  <option value="base">Обязательный</option>
                                  <option value="optional">Опциональный</option>
                                </Select>
                              </Field>
                            </div>
                            {line.choice === 'new' && (
                              showNewItemPrice ? (
                                <div className="mt-2 grid gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 sm:grid-cols-2">
                                  <Field
                                    label={`Количество в упаковке, ${UNIT_LABELS[line.unit ?? ''] ?? 'ед.'}`}
                                    hint="Укажите размер упаковки в той же единице, что и ингредиент: например, 1000 мл."
                                  >
                                    <Input
                                      type="number"
                                      min="0"
                                      step="any"
                                      disabled={savingStockItemKey === newItemKey}
                                      value={line.newItemPackageQty ?? ''}
                                      onChange={(event) => updateLine(recipeIndex, lineIndex, {
                                        newItemPackageQty: event.target.value ? Number(event.target.value) : null,
                                      })}
                                      aria-label={`Количество в упаковке: ${line.ingredientName}`}
                                    />
                                  </Field>
                                  <Field label="Цена упаковки, ₽" hint="Себестоимость единицы будет рассчитана автоматически.">
                                    <Input
                                      type="number"
                                      min="0"
                                      step="any"
                                      disabled={savingStockItemKey === newItemKey}
                                      value={line.newItemPackagePriceRub ?? ''}
                                      onChange={(event) => updateLine(recipeIndex, lineIndex, {
                                        newItemPackagePriceRub: event.target.value === '' ? null : Number(event.target.value),
                                      })}
                                      aria-label={`Цена упаковки: ${line.ingredientName}`}
                                    />
                                  </Field>
                                </div>
                              ) : (
                                <p className="mt-2 text-xs text-ink-secondary">
                                  Размер и цена упаковки задаются один раз для всех строк «{line.ingredientName}» ({UNIT_LABELS[line.unit ?? ''] ?? 'единица не выбрана'}).
                                </p>
                              )
                            )}
                            {showNewItemPrice && (
                              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                                <span className="text-xs text-ink-secondary">
                                  Позиция создастся и при сохранении всей книги; отдельная кнопка — чтобы завести её сразу.
                                </span>
                                <Button
                                  variant="secondary"
                                  className="w-full sm:w-auto"
                                  disabled={
                                    savingStockItemKey !== null ||
                                    line.ingredientName.trim().length < 2 ||
                                    !line.unit
                                  }
                                  loading={savingStockItemKey === newItemKey}
                                  onClick={() => void saveNewStockItem(line)}
                                >
                                  Создать и сохранить позицию
                                </Button>
                              </div>
                            )}
                            {invalidEspressoLink && <p className="text-xs font-medium text-bad">Укажите существующую техкарту Espresso. Эспрессо нельзя создать как складской ингредиент или пропустить.</p>}
                            {lineError && line.choice !== 'skip' && <p className="text-xs font-medium text-bad">Проверьте название, количество, единицу и выбранную позицию.</p>}
                            {line.matches.some((match) => !match.exact) && (
                              <p className="text-xs text-amber-800">
                                Похожие складские позиции: {line.matches.filter((match) => !match.exact).map((match) => `${match.name} (${match.score.toFixed(2)})`).join('; ')}. Подтвердите производителя/вкус вручную.
                              </p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                    {!!issues.length && (
                      <Banner tone="bad">
                        {issues.map((issue) => <div key={issue}>{issue}</div>)}
                      </Banner>
                    )}
                  </>
                )}
              </Card>
            )
          })}
          {busy && <Spinner label="Сохраняю версии и отмечаю карты для проверки…" />}
        </div>
      )}
    </Drawer>
  )
}

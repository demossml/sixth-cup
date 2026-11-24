import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileText, Plus, XCircle } from 'lucide-react'

import { api, uploadAdminFile } from '../../api/client'
import { UNIT_LABELS } from '../../lib/costMath'
import { Badge, Banner, Button, Card, Drawer, Field, Input, Select, Spinner, useToast } from '../../ui/kit'

type Unit = 'kg' | 'l' | 'g' | 'ml' | 'pcs'
type ImportUnit = 'g' | 'ml' | 'pcs'
type Match = { id: number; name: string; exact: boolean; score: number }
type CurrentLine = {
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
  currentLines: CurrentLine[]
}
type IngredientMatch = Match & { unit: Unit; packageQty: number | null; packagePriceRub: number | null }
type SemiMatch = Match & { kind: 'dish' | 'semi' | 'modifier'; productId: number | null }
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
type CatalogItem = { id: number; name: string; unit: Unit }
type CatalogCard = { id: number; name: string; kind: 'dish' | 'semi' | 'modifier'; productId: number | null; outputUnit?: string }
type Product = { id: number; name: string }
type WorkbookPreview = {
  sourceName: string
  recipes: PreviewRecipe[]
  warnings: string[]
  stockItems: CatalogItem[]
  cards: CatalogCard[]
  products: Product[]
}
type LineDraft = PreviewLine & { choice: string }
type RecipeDraft = Omit<PreviewRecipe, 'lines'> & {
  action: string
  newCardKind: 'dish' | 'semi' | 'modifier' | ''
  productId: number | ''
  outputQty: number | null
  outputUnit: Unit | ''
  lines: LineDraft[]
}
type SavedCards = { applied: number; cards: { id: number; name: string; changeKind: 'created' | 'updated' }[] }

const units: ImportUnit[] = ['g', 'ml', 'pcs']
const stockChoice = (id: number) => `stock:${id}`
const semiChoice = (id: number) => `semi:${id}`

function defaultLineChoice(line: PreviewLine): string {
  const exactStock = line.matches.filter((match) => match.exact && match.unit === line.unit)
  if (exactStock.length === 1) return stockChoice(exactStock[0]!.id)
  const exactSemi = line.semiMatches.filter((match) => match.exact)
  return exactSemi.length === 1 ? semiChoice(exactSemi[0]!.id) : ''
}

function defaultRecipeAction(recipe: PreviewRecipe): string {
  const exact = recipe.cardMatches.filter((match) => match.exact)
  return exact.length === 1 ? `card:${exact[0]!.id}` : 'skip'
}

function compositionDiff(recipe: RecipeDraft, current: CurrentLine[], preview: WorkbookPreview) {
  const unused = new Set(current.map((_, index) => index))
  const changes: { kind: 'added' | 'updated' | 'removed'; before?: CurrentLine; after?: LineDraft }[] = []
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
  for (const index of unused) changes.push({ kind: 'removed', before: current[index] })
  return changes
}

function lineLabel(line: CurrentLine | LineDraft, preview: WorkbookPreview): string {
  if ('choice' in line) {
    if (line.choice.startsWith('stock:')) {
      return preview.stockItems.find((item) => item.id === Number(line.choice.slice(6)))?.name ?? line.ingredientName
    }
    if (line.choice.startsWith('semi:')) {
      return `Заготовка: ${preview.cards.find((card) => card.id === Number(line.choice.slice(5)))?.name ?? line.ingredientName}`
    }
    return line.ingredientName
  }
  return line.name
}

function buildDrafts(preview: WorkbookPreview): RecipeDraft[] {
  return preview.recipes.map((recipe) => {
    const action = defaultRecipeAction(recipe)
    const target = action.startsWith('card:') ? recipe.cardMatches.find((match) => match.id === Number(action.slice(5))) : undefined
    return {
      ...recipe,
      action,
      newCardKind: recipe.kind,
      productId: target?.productId ?? '',
      outputQty: recipe.kind === 'semi' ? null : 1,
      outputUnit: recipe.kind === 'semi' ? '' : 'pcs',
      lines: recipe.lines.map((line) => ({ ...line, choice: defaultLineChoice(line) })),
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
  const kind = target?.kind ?? (recipe.action === 'create' ? recipe.newCardKind : null)
  if (kind !== 'semi' && !recipe.productId && !target?.productId) errors.push('Для карты блюда выберите товар каталога')
  const selectedLines = recipe.lines.filter((line) => line.choice !== 'skip')
  if (!selectedLines.length) errors.push('Добавьте или выберите хотя бы один ингредиент')
  for (const [index, line] of selectedLines.entries()) {
    const label = `Строка ${index + 1}`
    if (line.ingredientName.trim().length < 2) errors.push(`${label}: укажите ингредиент`)
    if (!line.unit || !units.includes(line.unit)) errors.push(`${label}: подтвердите единицу измерения`)
    if (line.qty == null || !Number.isFinite(line.qty) || line.qty <= 0) errors.push(`${label}: укажите одно точное количество`)
    if (!line.choice) errors.push(`${label}: сопоставьте ингредиент или явно создайте новую позицию`)
    if (line.choice.startsWith('stock:')) {
      const item = preview.stockItems.find((candidate) => candidate.id === Number(line.choice.slice(6)))
      if (!item || item.unit !== line.unit) errors.push(`${label}: единица выбранного ингредиента не совпадает`)
    }
    if (line.choice.startsWith('semi:')) {
      const card = preview.cards.find((candidate) => candidate.id === Number(line.choice.slice(5)))
      if (!card || card.kind !== 'semi' || card.outputUnit !== line.unit) errors.push(`${label}: единица выбранной заготовки не совпадает`)
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

  const included = recipes.filter((recipe) => recipe.action !== 'skip')
  const errors = useMemo(
    () => preview ? recipes.flatMap((recipe) => recipeErrors(recipe, preview).map((error) => `${recipe.name}: ${error}`)) : [],
    [recipes, preview],
  )

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
    setRecipes((current) => current.map((recipe, i) => i !== recipeIndex
      ? recipe
      : { ...recipe, lines: recipe.lines.map((line, j) => j === lineIndex ? { ...line, ...patch } : line) }))
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
          return {
            name: recipe.name.trim(),
            sourceSheet: recipe.sourceSheet,
            sourceRow: recipe.sourceRow,
            targetCardId,
            newCardKind: targetCardId == null ? recipe.newCardKind || null : null,
            productId: recipe.productId === '' ? target?.productId ?? null : Number(recipe.productId),
            outputQty: targetCardId == null ? recipe.outputQty : null,
            outputUnit: targetCardId == null ? recipe.outputUnit || null : null,
            methodText: recipe.methodText,
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
      layer={75}
      footer={preview ? (
        <>
          <span className="mr-auto self-center text-xs text-ink-secondary">
            К сохранению: {included.length} из {recipes.length}
          </span>
          <Button variant="ghost" disabled={busy} onClick={() => { setPreview(null); setRecipes([]) }}>Выбрать другой файл</Button>
          <Button disabled={busy || !included.length || errors.length > 0} loading={busy} onClick={() => void save()}>
            Сохранить проверенные карты
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
            Файл сначала только анализируется. Составы не изменятся, пока вы не проверите сопоставление каждой включённой карты и не нажмёте «Сохранить проверенные карты».
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
            {preview.sourceName}: листов обработано {new Set(preview.recipes.map((recipe) => recipe.sourceSheet)).size}, карт найдено {recipes.length}. Точные совпадения подставлены как варианты; похожие названия не связываются автоматически.
          </Banner>
          {preview.warnings.map((warning) => <Banner key={warning} tone="warn">{warning}</Banner>)}
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge tone="ok">Точное сопоставление</Badge>
            <Badge tone="warn">Проверьте похожее название</Badge>
            <Badge tone="bad">Не хватает обязательных данных</Badge>
          </div>
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
                </div>
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
                    <Field label="Товар каталога" hint="Не выбирайте похожий товар наугад: связь влияет на фудкост и продажи.">
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
                      ) : changes.map((change, index) => (
                        <div
                          key={`${change.kind}-${index}`}
                          className={`rounded-lg px-2 py-1.5 text-sm ${
                            change.kind === 'added' ? 'bg-green-50 text-green-900' :
                              change.kind === 'updated' ? 'bg-amber-50 text-amber-900' :
                                'bg-red-50 text-red-900'
                          }`}
                        >
                          {change.kind === 'added' && <>Добавится: {lineLabel(change.after!, preview)} — {change.after!.qty ?? 'не указано'} {UNIT_LABELS[change.after!.unit ?? '']}</>}
                          {change.kind === 'updated' && <>Изменится: {lineLabel(change.before!, preview)} {change.before!.qtyBrutto} → {change.after!.qty} {UNIT_LABELS[change.after!.unit ?? '']}</>}
                          {change.kind === 'removed' && <>Будет удалено из карты: {lineLabel(change.before!, preview)} — {change.before!.qtyBrutto} {UNIT_LABELS[change.before!.unit ?? '']}</>}
                        </div>
                      ))}
                      {changes.some((change) => change.kind === 'removed') && (
                        <Banner tone="warn">Строки, которых нет в Excel, будут удалены из новой версии. Проверьте этот список перед сохранением.</Banner>
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
                        <span className="text-sm font-semibold">Состав из Excel — сверка со складом</span>
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
                        }] })}>
                          <Plus size={14} /> Строка
                        </Button>
                      </div>
                      {recipe.lines.map((line, lineIndex) => {
                        const selectedItem = line.choice.startsWith('stock:') ? preview.stockItems.find((item) => item.id === Number(line.choice.slice(6))) : null
                        const selectedSemi = line.choice.startsWith('semi:') ? preview.cards.find((card) => card.id === Number(line.choice.slice(5))) : null
                        const lineError = line.choice !== 'skip' && (!line.ingredientName.trim() || !line.unit || !line.qty || line.qty <= 0 || (selectedItem && selectedItem.unit !== line.unit) || (selectedSemi && selectedSemi.outputUnit !== line.unit))
                        return (
                          <div key={`${line.sourceRow}-${lineIndex}`} className={`rounded-xl border p-2 ${lineError ? 'border-red-300 bg-red-50/30' : 'border-line'}`}>
                            <div className="mb-2 flex items-center gap-2 text-xs text-ink-secondary">
                              <span className="font-medium">Excel, строка {line.sourceRow}:</span>
                              <span className="break-all">{line.sourceText}</span>
                              {line.issues.map((issue) => <span key={issue} className="text-bad">{issue}</span>)}
                            </div>
                            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                              <Field label="Ингредиент">
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
                                  <option value="">— выберите вручную —</option>
                                  <option value="new">Создать позицию склада</option>
                                  {preview.stockItems.map((item) => (
                                    <option key={`stock-${item.id}`} value={stockChoice(item.id)} disabled={item.unit !== line.unit}>
                                      {item.name} ({UNIT_LABELS[item.unit]}){line.matches.some((match) => match.id === item.id && match.exact) ? ' · точное' : ''}
                                    </option>
                                  ))}
                                  {preview.cards.filter((card) => card.kind === 'semi').map((card) => (
                                    <option key={`semi-${card.id}`} value={semiChoice(card.id)} disabled={card.outputUnit !== line.unit}>
                                      Заготовка: {card.name} ({card.outputUnit})
                                    </option>
                                  ))}
                                  <option value="skip">Не включать эту строку</option>
                                </Select>
                              </Field>
                              <Field label="Вклад в техкарту">
                                <Select value={line.lineRole} onChange={(event) => updateLine(recipeIndex, lineIndex, { lineRole: event.target.value as PreviewLine['lineRole'] })}>
                                  <option value="base">Обязательный</option>
                                  <option value="optional">Опциональный</option>
                                </Select>
                              </Field>
                            </div>
                            {line.choice === 'new' && <Banner tone="warn">Новая складская позиция будет создана без цены. Её себестоимость останется незаполненной до внесения цены.</Banner>}
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

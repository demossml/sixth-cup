import { useState } from 'react'

import { api, uploadAdminFile } from '../../api/client'
import { Badge, Banner, Button, Card, Drawer, Field, Input, Select, Spinner, cx, useToast } from '../../ui/kit'
import { AlertTriangle, CheckCircle2, FileText, Upload, XCircle } from 'lucide-react'
import { UNIT_LABELS } from '../../lib/costMath'
import { extractPdfText } from '../../lib/ingredientImportFiles'
import TechCardWorkbookImport from './TechCardWorkbookImport'

type ImportMatch = {
  id: number
  name: string
  unit: 'g' | 'ml' | 'pcs'
  packageQty: number | null
  packagePriceRub: number | null
  exact: boolean
  score: number
}

type IngredientCandidate = {
  name: string
  category: string
  unit: 'g' | 'ml' | 'pcs' | ''
  packQty: number | null
  packPriceRub: number | null
  orderQty: number | null
  confidence: 'high' | 'medium' | 'low'
  sourceLine: string
  notes: string[]
  matches: ImportMatch[]
}

type IngredientDraft = IngredientCandidate & {
  action: 'create' | 'update' | 'skip'
  stockItemId: number | null
}

type IngredientPreview = {
  items: IngredientCandidate[]
  provider: 'deepseek' | 'heuristic'
  sourceName: string | null
  unparsedLines: string[]
}

const COST_UNITS = ['g', 'ml', 'pcs'] as const
const FILE_LIMIT = 15 * 1024 * 1024

function rowIssues(row: IngredientDraft): string[] {
  const issues: string[] = []
  if (row.name.trim().length < 2) issues.push('Укажите название')
  if (!row.unit) issues.push('Выберите единицу')
  if (row.packQty == null || !Number.isFinite(row.packQty) || row.packQty <= 0) issues.push('Укажите фасовку одной упаковки')
  if (row.packPriceRub == null || !Number.isFinite(row.packPriceRub) || row.packPriceRub < 0) issues.push('Укажите цену одной упаковки')
  return issues
}

function makeDraft(item: IngredientCandidate): IngredientDraft {
  const invalid = item.name.trim().length < 2 || !item.unit || item.packQty == null || item.packPriceRub == null
  return {
    ...item,
    action: invalid || item.confidence !== 'high' || item.notes.length > 0 || item.matches.length > 0
      ? 'skip'
      : 'create',
    stockItemId: null,
  }
}

export default function ImportPanel({
  onClose,
  onImported,
}: {
  onClose: () => void
  onImported: (summary: string) => void
}) {
  const toast = useToast()
  const [mode, setMode] = useState<'ingredients' | 'techcards'>('ingredients')
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState('')
  const [preview, setPreview] = useState<IngredientPreview | null>(null)
  const [rows, setRows] = useState<IngredientDraft[]>([])
  const [pdfWarnings, setPdfWarnings] = useState<string[]>([])
  const [result, setResult] = useState<string | null>(null)

  const skippedCount = rows.filter((row) => row.action === 'skip').length
  const selectedRows = rows.filter((row) => row.action !== 'skip')
  const invalidSelected = selectedRows.some((row) => rowIssues(row).length > 0)
  const readyCount = rows.filter((row) => row.action !== 'skip' && rowIssues(row).length === 0).length

  const startPreview = async () => {
    if (!file && !text.trim()) {
      toast.push('Вставьте текст или выберите файл', 'bad')
      return
    }
    setBusy(true)
    setBusyLabel('Подготавливаю документ…')
    setPreview(null)
    try {
      let response: IngredientPreview
      if (file && !file.name.toLowerCase().endsWith('.pdf')) {
        response = await uploadAdminFile<IngredientPreview>('/cost/items/import/preview', file)
      } else {
        let sourceText = text
        if (file?.name.toLowerCase().endsWith('.pdf')) {
          if (file.size > FILE_LIMIT) throw new Error('Файл больше 15 МБ')
          const extracted = await extractPdfText(file, setBusyLabel)
          sourceText = extracted.text
          setText(sourceText)
          if (extracted.ocrPages) {
            setPdfWarnings([
              `На ${extracted.ocrPages} стр. применён OCR. Текст распознан в браузере; проверьте цифры и фасовки особенно внимательно.`,
            ])
          } else {
            setPdfWarnings([])
          }
        }
        response = await api<IngredientPreview>('/cost/items/import/preview', {
          method: 'POST',
          body: { text: sourceText, sourceName: file?.name ?? null },
        })
      }
      setPreview(response)
      setRows(response.items.map(makeDraft))
      if (!response.items.length) {
        toast.push('Не удалось выделить позиции. Попробуйте вставить текст или исправить его вручную.', 'bad')
      }
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Не удалось разобрать документ', 'bad')
    } finally {
      setBusy(false)
      setBusyLabel('')
    }
  }

  const updateRow = (index: number, patch: Partial<IngredientDraft>) => {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row))
  }

  const confirmImport = async () => {
    if (!selectedRows.length || invalidSelected) return
    setBusy(true)
    try {
      const payload = rows.map((row) => {
        if (row.action === 'skip') return { action: 'skip' as const }
        const common = {
          name: row.name.trim(),
          unit: row.unit as (typeof COST_UNITS)[number],
          packageQty: Number(row.packQty),
          packagePriceRub: Number(row.packPriceRub),
        }
        if (row.action === 'update' && row.stockItemId != null) {
          return { action: 'update' as const, stockItemId: row.stockItemId, ...common }
        }
        return { action: 'create' as const, ...common }
      })
      const saved = await api<{ created: number; updated: number; skipped: number }>('/cost/items/import/confirm', {
        method: 'POST',
        body: { items: payload },
      })
      const summary = `создано ${saved.created}, обновлено ${saved.updated}, пропущено ${saved.skipped}`
      setPreview(null)
      setRows([])
      setText('')
      setFile(null)
      setResult(summary)
      onImported(summary)
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Не удалось сохранить ингредиенты', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const sectionButton = (value: 'ingredients' | 'techcards', label: string) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      className={cx('seg-item', mode === value && 'is-on')}
      aria-pressed={mode === value}
    >
      {label}
    </button>
  )

  return (
    <>
      <Card className="space-y-3 border-brand p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-semibold">
            <Upload size={18} /> Импорт
          </div>
          <Button variant="ghost" onClick={onClose}>Закрыть</Button>
        </div>
        <div className="seg-wrap">
          {sectionButton('ingredients', 'Ингредиенты')}
          {sectionButton('techcards', 'Техкарты')}
        </div>

        {mode === 'ingredients' ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-secondary">
              Вставьте письмо или загрузите Excel, CSV либо PDF. Файл ещё не меняет справочник: сначала откроется окно проверки.
              Количество упаковок в заказе будет показано отдельно и не попадёт в остатки.
            </p>
            <Field label="Текст из письма или заказа">
              <textarea
                className="min-h-[150px] w-full rounded-xl border border-line p-3 font-mono text-sm"
                placeholder={'Сироп Кокос (COCO.IN) 0,7 - 2 шт x 810 ₽'}
                value={text}
                onChange={(event) => {
                  setText(event.target.value)
                  setFile(null)
                }}
              />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm hover:bg-surface-2">
                <FileText size={16} />
                {file?.name ?? 'Выбрать Excel / CSV / PDF'}
                <input
                  type="file"
                  className="sr-only"
                  accept=".xlsx,.xls,.csv,.tsv,.txt,.pdf"
                  disabled={busy}
                  onChange={(event) => {
                    const selected = event.target.files?.[0] ?? null
                    if (selected && selected.size > FILE_LIMIT) {
                      toast.push('Файл больше 15 МБ', 'bad')
                      event.currentTarget.value = ''
                      return
                    }
                    setFile(selected)
                    setText('')
                    setPdfWarnings([])
                    setPreview(null)
                  }}
                />
              </label>
              <Button disabled={busy || (!file && !text.trim())} onClick={() => void startPreview()}>
                {busy ? busyLabel || 'Разбираю…' : 'Распознать и проверить'}
              </Button>
            </div>
            <div className="text-xs text-ink-secondary">
              PDF обрабатывается в браузере. Для сканов используется OCR; файл и изображение страниц не отправляются AI-провайдеру — передаётся только распознанный текст.
            </div>
            {pdfWarnings.map((warning) => <Banner key={warning} tone="warn">{warning}</Banner>)}
          </div>
        ) : (
          <TechcardImport onImported={onImported} />
        )}
        {busy && <Spinner label={busyLabel || 'Работаю…'} />}
        {result && <Banner tone="ok">Последний импорт: {result}</Banner>}
      </Card>

      <IngredientReview
        open={!!preview}
        preview={preview}
        rows={rows}
        warnings={pdfWarnings}
        busy={busy}
        readyCount={readyCount}
        skippedCount={skippedCount}
        invalidSelected={invalidSelected}
        onClose={() => setPreview(null)}
        onUpdate={updateRow}
        onConfirm={() => void confirmImport()}
      />
    </>
  )
}

function IngredientReview({
  open,
  preview,
  rows,
  warnings,
  busy,
  readyCount,
  skippedCount,
  invalidSelected,
  onClose,
  onUpdate,
  onConfirm,
}: {
  open: boolean
  preview: IngredientPreview | null
  rows: IngredientDraft[]
  warnings: string[]
  busy: boolean
  readyCount: number
  skippedCount: number
  invalidSelected: boolean
  onClose: () => void
  onUpdate: (index: number, patch: Partial<IngredientDraft>) => void
  onConfirm: () => void
}) {
  const footer = (
    <>
      <span className="mr-auto self-center text-xs text-ink-secondary">
        К добавлению/обновлению: {readyCount} · пропущено: {skippedCount}
      </span>
      <Button variant="ghost" onClick={onClose}>Назад</Button>
      <Button disabled={busy || readyCount === 0 || invalidSelected} loading={busy} onClick={onConfirm}>
        Сохранить подтверждённые
      </Button>
    </>
  )

  return (
    <Drawer open={open} onClose={onClose} title="Проверьте распознанные ингредиенты" wide layer={70} footer={footer}>
      {!preview ? null : (
        <div className="space-y-3">
          <div className="text-sm text-ink-secondary">
            {preview.sourceName ? `Источник: ${preview.sourceName} · ` : ''}
            Разобрано строк: {rows.length}. Количество в заказе — справочно, складские остатки не меняются.
          </div>
          {preview.provider === 'heuristic' && (
            <Banner tone="warn">
              AI-провайдер выключен. Предварительный разбор сделан по правилам текста; проверьте все значения перед сохранением.
            </Banner>
          )}
          {warnings.map((warning) => <Banner key={warning} tone="warn">{warning}</Banner>)}
          {!!preview.unparsedLines.length && (
            <Banner tone="warn">
              Не удалось разобрать строк с ценой: {preview.unparsedLines.length}. Их можно скопировать из исходного документа и вставить в текстовый ввод отдельно.
              <ul className="mt-1 list-disc pl-5">
                {preview.unparsedLines.slice(0, 8).map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
              </ul>
            </Banner>
          )}
          {!rows.length ? (
            <Banner tone="bad">Позиции не найдены. Вернитесь назад и проверьте исходный текст.</Banner>
          ) : (
            <div className="space-y-3">
              {rows.map((row, index) => {
                const errors = rowIssues(row)
                const warningsForRow = row.notes
                const tone = errors.length ? 'bad' : row.confidence === 'high' && !warningsForRow.length && !row.matches.length ? 'ok' : 'warn'
                const label = tone === 'bad' ? 'Исправить' : tone === 'warn' ? 'Проверить' : 'Готово'
                return (
                  <Card key={`${row.sourceLine}-${index}`} className={cx('space-y-2 border p-3', tone === 'bad' ? 'border-red-300 bg-red-50/40' : tone === 'warn' ? 'border-amber-300 bg-amber-50/30' : 'border-green-200')}>
                    <div className="flex flex-wrap items-center gap-2">
                      {tone === 'bad' ? <XCircle size={16} className="text-bad" /> : tone === 'warn' ? <AlertTriangle size={16} className="text-amber-700" /> : <CheckCircle2 size={16} className="text-ok" />}
                      <Badge tone={tone}>{label}</Badge>
                      <Badge tone="neutral">{row.confidence === 'high' ? 'уверенность высокая' : row.confidence === 'medium' ? 'уверенность средняя' : 'уверенность низкая'}</Badge>
                      {row.orderQty != null && <span className="text-xs text-ink-secondary">в заказе: {row.orderQty} уп.</span>}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[minmax(160px,2fr)_100px_130px_130px_minmax(190px,1.5fr)]">
                      <Field label="Ингредиент">
                        <Input value={row.name} onChange={(event) => onUpdate(index, { name: event.target.value })} />
                      </Field>
                      <Field label="Ед.">
                        <Select value={row.unit} onChange={(event) => onUpdate(index, { unit: event.target.value as IngredientDraft['unit'] })}>
                          <option value="">—</option>
                          {COST_UNITS.map((unit) => <option key={unit} value={unit}>{UNIT_LABELS[unit]}</option>)}
                        </Select>
                      </Field>
                      <Field label={`Фасовка, ${UNIT_LABELS[row.unit] ?? 'ед.'}`}>
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          value={row.packQty ?? ''}
                          onChange={(event) => onUpdate(index, { packQty: event.target.value === '' ? null : Number(event.target.value) })}
                        />
                      </Field>
                      <Field label="Цена упаковки, ₽">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.packPriceRub ?? ''}
                          onChange={(event) => onUpdate(index, { packPriceRub: event.target.value === '' ? null : Number(event.target.value) })}
                        />
                      </Field>
                      <Field label="Действие">
                        <Select
                          value={row.action === 'update' && row.stockItemId != null ? `update:${row.stockItemId}` : row.action}
                          onChange={(event) => {
                            const value = event.target.value
                            if (value === 'skip' || value === 'create') {
                              onUpdate(index, { action: value, stockItemId: null })
                              return
                            }
                            const stockItemId = Number(value.slice('update:'.length))
                            onUpdate(index, { action: 'update', stockItemId })
                          }}
                        >
                          <option value="create">Создать новую позицию</option>
                          {row.matches.filter((match) => match.unit === row.unit).map((match) => (
                            <option key={match.id} value={`update:${match.id}`}>
                              {match.exact ? 'Обновить: ' : 'Похожая: '}{match.name}
                            </option>
                          ))}
                          <option value="skip">Пропустить строку</option>
                        </Select>
                      </Field>
                    </div>
                    {!!errors.length && <div className="text-xs font-medium text-bad">{errors.join(' · ')}</div>}
                    {!!warningsForRow.length && <div className="text-xs text-amber-800">{warningsForRow.join(' · ')}</div>}
                    {!!row.matches.length && (
                      <div className="text-xs text-amber-800">
                        Найдены похожие позиции: {row.matches.map((match) => `${match.name} (${UNIT_LABELS[match.unit]})`).join('; ')}.
                        Выберите обновление или явно оставьте создание новой.
                      </div>
                    )}
                    {row.matches.some((match) => match.unit !== row.unit) && (
                      <div className="text-xs text-amber-800">Единицы найденной позиции отличаются: обновить её нельзя, только создать отдельную позицию или пропустить.</div>
                    )}
                    <details className="text-xs text-ink-secondary">
                      <summary className="cursor-pointer">Исходная строка</summary>
                      <div className="mt-1 break-words rounded bg-surface-2 p-2">{row.sourceLine || 'Исходная строка не сопоставлена'}</div>
                    </details>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      )}
    </Drawer>
  )
}

function TechcardImport({ onImported }: { onImported: (summary: string) => void }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)

  return (
    <div className="space-y-3">
      <Banner tone="warn">
        Для Excel-техкарт сначала выполняется проверка листов: ИИ сама сопоставляет карты, товары и ингредиенты. Действующие карты не меняются до нажатия «Сохранить всё и создать недостающее».
      </Banner>
      <Button onClick={() => setOpen(true)}><FileText size={14} /> Проверить Excel и импортировать</Button>
      {open && (
        <TechCardWorkbookImport
          onClose={() => setOpen(false)}
          onSaved={(result) => {
            setOpen(false)
            const created = result.cards.filter((card) => card.changeKind === 'created').length
            const updated = result.cards.length - created
            const summary = [
              `Сохранено карт: новых ${created}, обновлено ${updated}`,
              result.productsCreated > 0 ? `создано товаров: ${result.productsCreated}` : null,
            ].filter(Boolean).join(', ')
            toast.push(`${summary}. Они отмечены для проверки.`, 'ok')
            onImported(summary)
          }}
        />
      )}
    </div>
  )
}

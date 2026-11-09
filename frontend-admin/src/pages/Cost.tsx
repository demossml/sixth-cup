import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApi } from '../api/useApi'
import { api, tokenStore } from '../api/client'
import {
  PageHeader, Card, EmptyState, Badge, Button, Input, Select, Field,
  ErrorBox, Skeleton, Tabs, useToast, cx,
} from '../ui/kit'
import { Plus, RefreshCw, Sparkles, Trash2, Upload, Pencil } from 'lucide-react'
import { csvName, downloadCsv } from '../lib/csv'
import { initialCostTab, shouldAutoFocusMissing, type CostTabKey } from '../lib/costTabs'

type Cat = { id: number; name: string; sortOrder: number; isSystem: number }
type Ing = {
  id: number; name: string; unit: string; packQty: number; packPriceRub: number | null
  unitPriceRub: number | null; comment: string | null; active: boolean
  categoryId: number; categoryName: string; complete: boolean
}
type Line = {
  id?: number; ingredientId: number; ingredientName?: string; unit?: string
  qty: number; lineRole: 'base' | 'optional'; lineSumRub?: number | null; complete?: boolean
}
type Recipe = {
  id: number; name: string; outputLabel: string | null; markupPct: number
  retailPriceRub: number | null; methodText: string | null
  costRub: number | null; optionalRub: number | null; missingPrices: boolean
  retailCalcRub: number | null; marginRub: number | null; marginPct: number | null
  lines: Line[]
}
type SummaryRow = {
  id: number; name: string; costRub: number | null; markupPct: number
  retailRub: number | null; marginPct: number | null; missingPrices: boolean; warnings: string[]
}

const UNIT_LABEL: Record<string, string> = { g: 'г', ml: 'мл', pcs: 'шт' }
const API = (import.meta as any).env?.VITE_API_URL ?? ''

export default function Cost() {
  const [params] = useSearchParams()
  // ?focus=missing — из импорта техкарты и внешних ссылок: сразу режим дозаполнения.
  const focusMissing = params.get('focus') === 'missing'
  const [tab, setTab] = useState<CostTabKey>(initialCostTab(params.get('focus')))
  const cats = useApi<{ categories: Cat[] }>('/cost/categories')
  const ings = useApi<{ ingredients: Ing[] }>('/cost/ingredients')
  const recipes = useApi<{ recipes: Recipe[] }>('/cost/recipes')
  const summary = useApi<{ rows: SummaryRow[] }>(tab === 'summary' ? '/cost/summary' : null)
  const toast = useToast()
  const reloadAll = () => {
    cats.reload(); ings.reload(); recipes.reload(); summary.reload()
  }

  const ingredientList = ings.data?.ingredients || []
  const missingCount = useMemo(() => ingredientList.filter((i) => !i.complete).length, [ingredientList])

  // Первый ответ справочника: если есть незаполненные позиции — открываем «Дозаполнить»,
  // но только пока кассир сам не выбрал другую вкладку.
  const tabTouched = useRef(false)
  const autoTabDone = useRef(false)
  useEffect(() => {
    const decide = shouldAutoFocusMissing({
      focusMissing,
      userPicked: tabTouched.current,
      alreadyDone: autoTabDone.current,
      hasData: Boolean(ings.data),
      missingCount,
    })
    if (!ings.data || tabTouched.current) return
    autoTabDone.current = true
    if (decide) setTab('fill')
  }, [ings.data, missingCount, focusMissing])

  const selectTab = (k: CostTabKey) => {
    tabTouched.current = true
    setTab(k)
  }

  const [uploadOpen, setUploadOpen] = useState(false)
  const [importInfo, setImportInfo] = useState<{ count: number; names: string[] } | null>(null)
  const [missingSignal, setMissingSignal] = useState(0)

  /** Импорт завершён: обновляем справочник и рецепты, ведём кассира к незаполненным ценам. */
  const onImported = (res: { missingIngredientNames?: string[] }) => {
    ings.reload(); cats.reload(); recipes.reload()
    setUploadOpen(false)
    const names = res.missingIngredientNames
    // undefined — источник не сообщает о ценах (ИИ-прайс): баннер не показываем.
    setImportInfo(names === undefined ? null : { count: names.length, names })
    selectTab('fill')
    if (names && names.length) setMissingSignal((n) => n + 1)
    toast.push('Импорт завершён')
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Себестоимость"
        subtitle="Техкарты, ингредиенты и наценка. Неполные позиции — красным, в себес не входят."
        actions={
          <>
            <Button variant="secondary" onClick={reloadAll}><RefreshCw size={16} /> Обновить</Button>
            <Button onClick={() => setUploadOpen(true)}><Upload size={16} /> Загрузить</Button>
          </>
        }
      />
      {uploadOpen && (
        <UploadPanel onClose={() => setUploadOpen(false)} onImported={onImported} />
      )}
      {importInfo && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
          {importInfo.count > 0 ? (
            <>
              <b>{importInfo.count} позиций без цены.</b> В себестоимость они не войдут, пока не укажете цену закупки.
              {importInfo.names.length > 0 && (
                <div className="mt-1 text-ink-secondary">
                  {importInfo.names.slice(0, 10).join(', ')}
                  {importInfo.names.length > 10 ? '…' : ''}
                </div>
              )}
              <div className="mt-2">
                <Button size="sm" onClick={() => { selectTab('fill'); setMissingSignal((n) => n + 1) }}>
                  Показать без цены
                </Button>
              </div>
            </>
          ) : (
            <b>Импорт завершён: все позиции с ценами.</b>
          )}
        </div>
      )}
      <Tabs
        value={tab}
        onChange={selectTab}
        items={[
          { key: 'fill', label: 'Дозаполнить', count: missingCount || null },
          { key: 'recipes', label: 'Рецепты' },
          { key: 'summary', label: 'Сводка' },
        ]}
      />
      {tab === 'fill' && (
        <FillTab
          cats={cats.data?.categories || []}
          ings={ingredientList}
          loading={ings.loading}
          error={ings.error}
          focusMissingSignal={missingSignal}
          onChange={() => { ings.reload(); cats.reload(); recipes.reload() }}
        />
      )}
      {tab === 'recipes' && (
        <RecipesTab
          ings={ings.data?.ingredients || []}
          recipes={recipes.data?.recipes || []}
          loading={recipes.loading}
          error={recipes.error}
          onChange={() => { recipes.reload(); ings.reload() }}
        />
      )}
      {tab === 'summary' && (
        <SummaryTab rows={summary.data?.rows || []} loading={summary.loading} error={summary.error} />
      )}
    </div>
  )
}

function FillTab({
  cats, ings, loading, error, onChange, focusMissingSignal = 0,
}: {
  cats: Cat[]; ings: Ing[]; loading: boolean; error: string; onChange: () => void
  /** Растёт, когда кассир просит показать позиции без цены (импорт, deep link). */
  focusMissingSignal?: number
}) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [catId, setCatId] = useState('')
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({
    name: '', categoryId: '', unit: 'ml', packQty: '1000', packPriceRub: '', comment: '',
  })
  const [newCat, setNewCat] = useState('')

  useEffect(() => {
    if (focusMissingSignal > 0) setOnlyMissing(true)
  }, [focusMissingSignal])

  const filtered = useMemo(() => {
    return ings.filter((i) => {
      if (q && !i.name.toLowerCase().includes(q.toLowerCase())) return false
      if (catId && String(i.categoryId) !== catId) return false
      if (onlyMissing && i.complete) return false
      return true
    })
  }, [ings, q, catId, onlyMissing])

  const openEdit = (i: Ing) => {
    setEditId(i.id)
    setForm({
      name: i.name,
      categoryId: String(i.categoryId),
      unit: i.unit,
      packQty: String(i.packQty),
      packPriceRub: i.packPriceRub != null ? String(i.packPriceRub) : '',
      comment: i.comment || '',
    })
    setShowForm(true)
  }

  const saveIng = async () => {
    try {
      const body = {
        name: form.name.trim(),
        categoryId: Number(form.categoryId || cats[0]?.id),
        unit: form.unit,
        packQty: Number(form.packQty),
        packPriceRub: form.packPriceRub === '' ? null : Number(form.packPriceRub),
        comment: form.comment || null,
      }
      if (editId) {
        await api(`/cost/ingredients/${editId}`, { method: 'PUT', body })
        toast.push('Сохранено')
      } else {
        await api('/cost/ingredients', { method: 'POST', body })
        toast.push('Ингредиент добавлен')
      }
      setShowForm(false)
      setEditId(null)
      onChange()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    }
  }

  const removeIng = async (i: Ing) => {
    if (!confirm(`Удалить «${i.name}»?`)) return
    try {
      await api(`/cost/ingredients/${i.id}`, { method: 'DELETE' })
      toast.push('Удалено')
      onChange()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    }
  }

  const addCategory = async () => {
    if (!newCat.trim()) return
    try {
      await api('/cost/categories', { method: 'POST', body: { name: newCat.trim() } })
      toast.push('Категория создана')
      setNewCat('')
      onChange()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-end">
        <Field label="Поиск"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Молоко, стакан…" /></Field>
        <Field label="Категория">
          <Select value={catId} onChange={(e) => setCatId(e.target.value)}>
            <option value="">Все</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm pb-2">
          <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
          Только без цены
        </label>
        <Button onClick={() => { setEditId(null); setForm({ name: '', categoryId: '', unit: 'ml', packQty: '1000', packPriceRub: '', comment: '' }); setShowForm(true) }}>
          <Plus size={16} /> Ингредиент
        </Button>
      </div>
      <Card className="p-3 flex flex-wrap gap-2 items-end">
        <Field label="Новая категория">
          <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Напр. Маршмеллоу" />
        </Field>
        <Button variant="ghost" onClick={addCategory}><Plus size={16} /> Категория</Button>
      </Card>
      {error && <ErrorBox message={error} />}
      {loading && !ings.length ? <Skeleton className="h-40" /> : null}
      {!loading && !filtered.length ? (
        <EmptyState
          title="Справочник пуст"
          text="Импортируйте Excel-техкарту или добавьте молоко, кофе, стаканы вручную."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-ink-secondary">
              <tr>
                <th className="p-2">Название</th>
                <th className="p-2">Категория</th>
                <th className="p-2">Фасовка</th>
                <th className="p-2">₽/фас.</th>
                <th className="p-2">₽/ед.</th>
                <th className="p-2">Статус</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr
                  key={i.id}
                  className={cx('border-t border-line', !i.complete && 'bg-red-50 text-red-800')}
                >
                  <td className="p-2 font-medium">{i.name}</td>
                  <td className="p-2">{i.categoryName}</td>
                  <td className="p-2">{i.packQty} {UNIT_LABEL[i.unit] || i.unit}</td>
                  <td className="p-2">{i.packPriceRub ?? '—'}</td>
                  <td className="p-2">{i.unitPriceRub != null ? i.unitPriceRub.toFixed(4) : '—'}</td>
                  <td className="p-2">
                    {i.complete ? <Badge tone="ok">готов</Badge> : <Badge tone="bad">нет цены</Badge>}
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    <button type="button" className="mr-2" title="Изменить" onClick={() => openEdit(i)}><Pencil size={14} /></button>
                    <button type="button" title="Удалить" onClick={() => removeIng(i)}><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showForm && (
        <Card className="p-4 space-y-3 max-w-lg">
          <div className="font-semibold">{editId ? 'Редактировать' : 'Новый ингредиент'}</div>
          <Field label="Название"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Категория">
            <Select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              <option value="">—</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Ед.">
              <Select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                <option value="ml">мл</option>
                <option value="g">г</option>
                <option value="pcs">шт</option>
              </Select>
            </Field>
            <Field label="Фасовка"><Input value={form.packQty} onChange={(e) => setForm({ ...form, packQty: e.target.value })} /></Field>
            <Field label="Цена ₽"><Input value={form.packPriceRub} onChange={(e) => setForm({ ...form, packPriceRub: e.target.value })} placeholder="обязательно для себеса" /></Field>
          </div>
          <Field label="Комментарий"><Input value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} /></Field>
          <div className="flex gap-2">
            <Button onClick={saveIng}>Сохранить</Button>
            <Button variant="ghost" onClick={() => { setShowForm(false); setEditId(null) }}>Отмена</Button>
          </div>
        </Card>
      )}
    </div>
  )
}

type ImportResult = {
  parsed: number
  recipesCreated: number
  recipesUpdated: number
  ingredientsCreated: number
  missingIngredientNames?: string[]
}

/**
 * Единая точка импорта: Excel/CSV-файл, вставленный текст техкарты и ИИ-прайс.
 * Живёт в шапке страницы, чтобы на телефоне не было трёх кнопок в ряд.
 */
function UploadPanel({
  onClose, onImported,
}: {
  onClose: () => void
  onImported: (res: ImportResult) => void
}) {
  const toast = useToast()
  const [section, setSection] = useState<'file' | 'text' | 'ai'>('file')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const runText = async () => {
    setBusy(true)
    setResult(null)
    try {
      const res = await api<ImportResult>('/cost/import/techcard-text', { method: 'POST', body: { text } })
      setResult(
        `Рецептов: ${res.parsed} (новых ${res.recipesCreated}, обновлено ${res.recipesUpdated}). ` +
        `Новых ингредиентов: ${res.ingredientsCreated}.`,
      )
      onImported(res)
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка импорта', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const runFile = async (file: File) => {
    setBusy(true)
    setResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`${API}/api/admin/cost/import/techcard-file`, {
        method: 'POST',
        headers: { 'X-Admin-Token': tokenStore.get() },
        body: fd,
      })
      const j = (await res.json().catch(() => ({}))) as ImportResult & { error?: string; message?: string }
      if (!res.ok) throw new Error(j.error || j.message || res.statusText)
      setResult(
        `Файл «${file.name}»: рецептов ${j.parsed}, новых ингредиентов ${j.ingredientsCreated}.`,
      )
      onImported(j)
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка файла', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const sectionBtn = (key: 'file' | 'text' | 'ai', label: string) => (
    <button
      key={key}
      type="button"
      onClick={() => setSection(key)}
      className={cx('seg-item', section === key && 'is-on')}
      aria-pressed={section === key}
    >
      {label}
    </button>
  )

  return (
    <Card className="p-4 space-y-3 border-brand">
      <div className="flex justify-between items-center gap-2">
        <div className="font-semibold flex items-center gap-2"><Upload size={18} /> Загрузить</div>
        <Button variant="ghost" onClick={onClose}>Закрыть</Button>
      </div>
      <p className="text-sm text-ink-secondary">
        Техкарта из Excel/CSV или текстом — рецепты создадутся сами. Ингредиенты без цены
        появятся <span className="text-red-700 font-medium">красным</span> и не войдут в себес.
      </p>
      <div className="seg inline-flex flex-wrap gap-[2px] p-[3px] bg-surface-2 rounded-[10px] border border-line">
        {sectionBtn('file', 'Excel / файл')}
        {sectionBtn('text', 'Вставить текст')}
        {sectionBtn('ai', 'ИИ-прайс')}
      </div>

      {section === 'file' && (
        <div className="space-y-2">
          <input
            type="file"
            accept=".xlsx,.xls,.csv,.tsv,.txt"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void runFile(f)
            }}
          />
          <div className="text-xs text-ink-secondary">
            Excel (.xlsx/.xls), CSV/TSV или TXT. Техкарты и цены сопоставятся по названию.
          </div>
        </div>
      )}

      {section === 'text' && (
        <div className="space-y-2">
          <textarea
            className="w-full min-h-[140px] rounded-xl border border-line p-3 text-sm font-mono"
            placeholder={'КАПУЧИНО 200\nкофе молотый — 10 г\nмолоко — 150 мл\nстакан 200 мл — 1 шт'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button disabled={busy || !text.trim()} onClick={runText}>
            {busy ? 'Импорт…' : 'Импортировать текст'}
          </Button>
        </div>
      )}

      {section === 'ai' && <AiSection onDone={() => onImported({ parsed: 0, recipesCreated: 0, recipesUpdated: 0, ingredientsCreated: 0 })} />}

      {result && <div className="text-sm rounded-lg bg-surface-2 p-3">{result}</div>}
    </Card>
  )
}

/** ИИ-прайс: разбор текста в ингредиенты. Секция внутри «Загрузить». */
function AiSection({ onDone }: { onDone: () => void }) {
  const toast = useToast()
  const [text, setText] = useState('Молоко 3,2% 1 л — 95 ₽\nСтаканы 200 мл, 50 шт — 310 ₽\nКрышки 80 мм, 50 шт — 190 ₽')
  const [busy, setBusy] = useState(false)
  const [items, setItems] = useState<{
    name: string; category: string; unit: string; packQty: number
    packPriceRub: number | null; confidence: string; selected?: boolean
  }[]>([])

  const parse = async () => {
    setBusy(true)
    try {
      const res = await api<{ items: typeof items }>('/cost/ai/parse', { method: 'POST', body: { text } })
      setItems((res.items || []).map((i) => ({ ...i, selected: true })))
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка ИИ', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const commit = async () => {
    const sel = items.filter((i) => i.selected !== false)
    if (!sel.length) return
    try {
      await api('/cost/ingredients/bulk', {
        method: 'POST',
        body: {
          items: sel.map((i) => ({
            name: i.name,
            categoryName: i.category,
            unit: i.unit,
            packQty: i.packQty,
            packPriceRub: i.packPriceRub,
          })),
        },
      })
      toast.push(`Добавлено: ${sel.length}`)
      onDone()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    }
  }

  return (
    <div className="space-y-2">
      <div className="text-sm text-ink-secondary">
        Вставьте прайс поставщика — ИИ предложит ингредиенты с фасовкой и ценой. Проверьте и добавьте.
      </div>
      <textarea className="w-full min-h-[100px] rounded-xl border border-line p-3 text-sm" value={text} onChange={(e) => setText(e.target.value)} />
      <Button disabled={busy} onClick={parse}>{busy ? 'Разбираю…' : 'Извлечь'}</Button>
      {!!items.length && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-secondary">
                <th className="p-1"></th>
                <th className="p-1">Название</th>
                <th className="p-1">Фас.</th>
                <th className="p-1">₽</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={idx} className={cx('border-t border-line', it.packPriceRub == null && 'bg-red-50')}>
                  <td className="p-1">
                    <input type="checkbox" checked={it.selected !== false} onChange={(e) => {
                      const next = [...items]
                      next[idx] = { ...it, selected: e.target.checked }
                      setItems(next)
                    }} />
                  </td>
                  <td className="p-1">{it.name}</td>
                  <td className="p-1">{it.packQty} {UNIT_LABEL[it.unit] || it.unit}</td>
                  <td className="p-1">{it.packPriceRub ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button className="mt-2" onClick={commit}>Добавить выбранные</Button>
        </div>
      )}
    </div>
  )
}

function RecipesTab({
  ings, recipes, loading, error, onChange,
}: {
  ings: Ing[]; recipes: Recipe[]; loading: boolean; error: string; onChange: () => void
}) {
  const toast = useToast()
  const [sel, setSel] = useState<number | null>(null)
  const current = recipes.find((r) => r.id === sel) || null
  const [name, setName] = useState('')
  const [markup, setMarkup] = useState('300')
  const [retail, setRetail] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [addIngId, setAddIngId] = useState('')
  const [addQty, setAddQty] = useState('1')
  const [addRole, setAddRole] = useState<'base' | 'optional'>('base')

  const openRecipe = (r: Recipe) => {
    setSel(r.id)
    setName(r.name)
    setMarkup(String(r.markupPct))
    setRetail(r.retailPriceRub != null ? String(r.retailPriceRub) : '')
    setLines(r.lines.map((l) => ({ ...l, lineRole: l.lineRole as 'base' | 'optional' })))
  }

  const createRecipe = async () => {
    try {
      const res = await api<{ recipe: Recipe }>('/cost/recipes', {
        method: 'POST',
        body: { name: 'Новый рецепт', markupPct: 300, lines: [] },
      })
      toast.push('Рецепт создан')
      onChange()
      if (res.recipe) openRecipe(res.recipe)
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    }
  }

  const saveRecipe = async () => {
    if (!sel) return
    try {
      const res = await api<{ recipe: Recipe }>(`/cost/recipes/${sel}`, {
        method: 'PUT',
        body: {
          name,
          markupPct: Number(markup) || 0,
          retailPriceRub: retail === '' ? null : Number(retail),
          lines: lines.map((l) => ({
            ingredientId: l.ingredientId,
            qty: l.qty,
            lineRole: l.lineRole,
          })),
        },
      })
      toast.push('Сохранено')
      onChange()
      if (res.recipe) openRecipe(res.recipe)
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    }
  }

  const deleteRecipe = async () => {
    if (!sel || !confirm('Удалить рецепт?')) return
    try {
      await api(`/cost/recipes/${sel}`, { method: 'DELETE' })
      setSel(null)
      toast.push('Удалён')
      onChange()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    }
  }

  const addLine = () => {
    const id = Number(addIngId)
    const ing = ings.find((i) => i.id === id)
    if (!ing) {
      toast.push('Выберите ингредиент', 'neutral')
      return
    }
    setLines((prev) => [
      ...prev,
      {
        ingredientId: ing.id,
        ingredientName: ing.name,
        unit: ing.unit,
        qty: Number(addQty) || 1,
        lineRole: addRole,
        complete: ing.complete,
      },
    ])
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <Card className="p-2 space-y-1 max-h-[70vh] overflow-auto">
        <Button className="w-full mb-2" onClick={createRecipe}><Plus size={16} /> Рецепт</Button>
        {loading && <Skeleton className="h-20" />}
        {error && <ErrorBox message={error} />}
        {recipes.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => openRecipe(r)}
            className={cx(
              'w-full text-left rounded-lg px-2 py-1.5 text-sm',
              sel === r.id ? 'bg-brand-soft text-brand' : 'hover:bg-surface-2',
              r.missingPrices && 'border-l-2 border-red-500',
            )}
          >
            <div className="font-medium">{r.name}</div>
            <div className="text-xs text-ink-secondary">
              {r.costRub != null ? `${r.costRub.toFixed(2)} ₽` : 'себес —'}
              {r.missingPrices ? ' · есть позиции без цены' : ''}
            </div>
          </button>
        ))}
        {!recipes.length && !loading && (
          <EmptyState title="Нет рецептов" text="Импортируйте Excel или создайте вручную" />
        )}
      </Card>
      <div className="space-y-3">
        {!current ? (
          <EmptyState title="Выберите рецепт" text="Или импортируйте техкарту кнопкой «Загрузить»" />
        ) : (
          <>
            <Card className="p-4 space-y-3">
              <Field label="Название"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Наценка %"><Input value={markup} onChange={(e) => setMarkup(e.target.value)} /></Field>
                <Field label="Розница ₽"><Input value={retail} onChange={(e) => setRetail(e.target.value)} placeholder="утверждённая" /></Field>
              </div>
              <div className="flex flex-wrap gap-3 text-sm">
                <Badge tone="brand">Себес {current.costRub != null ? `${current.costRub.toFixed(2)} ₽` : '—'}</Badge>
                <Badge tone="neutral">Расчёт {current.retailCalcRub != null ? `${current.retailCalcRub.toFixed(2)} ₽` : '—'}</Badge>
                <Badge tone={current.marginPct != null && current.marginPct < 50 ? 'warn' : 'ok'}>
                  Маржа {current.marginPct != null ? `${current.marginPct}%` : '—'}
                </Badge>
              </div>
              {current.missingPrices && (
                <div className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
                  Красные строки без цены закупки не входят в себестоимость. Укажите цену в справочнике ингредиентов.
                </div>
              )}
              <div className="flex gap-2">
                <Button onClick={saveRecipe}>Сохранить</Button>
                <Button variant="ghost" onClick={deleteRecipe}>Удалить рецепт</Button>
              </div>
            </Card>
            <Card className="p-4 space-y-2">
              <div className="font-medium">Состав (напиток + стакан + крышка + …)</div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-ink-secondary">
                    <th className="p-1">Ингредиент</th>
                    <th className="p-1">Кол-во</th>
                    <th className="p-1">Роль</th>
                    <th className="p-1">Сумма</th>
                    <th className="p-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, idx) => {
                    const ing = ings.find((i) => i.id === l.ingredientId)
                    const incomplete = !(l.complete ?? ing?.complete)
                    return (
                      <tr key={idx} className={cx('border-t border-line', incomplete && 'bg-red-50 text-red-800')}>
                        <td className="p-1">
                          {l.ingredientName || ing?.name}
                          {incomplete && <span className="ml-1 text-xs">нет цены</span>}
                        </td>
                        <td className="p-1">
                          <Input
                            className="w-20"
                            value={String(l.qty)}
                            onChange={(e) => {
                              const next = [...lines]
                              next[idx] = { ...l, qty: Number(e.target.value) || 0 }
                              setLines(next)
                            }}
                          />{' '}
                          {UNIT_LABEL[l.unit || ing?.unit || ''] || ''}
                        </td>
                        <td className="p-1">
                          <Select
                            value={l.lineRole}
                            onChange={(e) => {
                              const next = [...lines]
                              next[idx] = { ...l, lineRole: e.target.value as 'base' | 'optional' }
                              setLines(next)
                            }}
                          >
                            <option value="base">база</option>
                            <option value="optional">по желанию</option>
                          </Select>
                        </td>
                        <td className="p-1">{incomplete ? '—' : (l.lineSumRub != null ? `${l.lineSumRub.toFixed(2)} ₽` : '—')}</td>
                        <td className="p-1">
                          <button type="button" onClick={() => setLines(lines.filter((_, i) => i !== idx))}>
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="flex flex-wrap gap-2 items-end">
                <Field label="Ингредиент">
                  <Select value={addIngId} onChange={(e) => setAddIngId(e.target.value)}>
                    <option value="">—</option>
                    {ings.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}{!i.complete ? ' (нет цены)' : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Кол-во"><Input className="w-24" value={addQty} onChange={(e) => setAddQty(e.target.value)} /></Field>
                <Field label="Роль">
                  <Select value={addRole} onChange={(e) => setAddRole(e.target.value as 'base' | 'optional')}>
                    <option value="base">база</option>
                    <option value="optional">по желанию</option>
                  </Select>
                </Field>
                <Button variant="ghost" onClick={addLine}><Plus size={16} /> Строка</Button>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}

function SummaryTab({ rows, loading, error }: { rows: SummaryRow[]; loading: boolean; error: string }) {
  const exportCsv = () => {
    downloadCsv(
      csvName('cost-summary'),
      ['name', 'cost', 'markup', 'retail', 'margin', 'warn'],
      rows.map((r) => [r.name, r.costRub ?? '', r.markupPct, r.retailRub ?? '', r.marginPct ?? '', r.warnings.join(';')]),
    )
  }
  return (
    <div className="space-y-3">
      <Button variant="ghost" onClick={exportCsv}>CSV</Button>
      {error && <ErrorBox message={error} />}
      {loading ? <Skeleton className="h-32" /> : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left">
              <tr>
                <th className="p-2">Рецепт</th>
                <th className="p-2">Себес</th>
                <th className="p-2">Наценка %</th>
                <th className="p-2">Розница</th>
                <th className="p-2">Маржа %</th>
                <th className="p-2">Статус</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={cx('border-t border-line', r.missingPrices && 'bg-red-50')}>
                  <td className="p-2 font-medium">{r.name}</td>
                  <td className="p-2">{r.costRub != null ? r.costRub.toFixed(2) : '—'}</td>
                  <td className="p-2">{r.markupPct}</td>
                  <td className="p-2">{r.retailRub != null ? r.retailRub.toFixed(2) : '—'}</td>
                  <td className="p-2">{r.marginPct != null ? r.marginPct : '—'}</td>
                  <td className="p-2">{r.missingPrices ? <Badge tone="bad">дозаполнить</Badge> : <Badge tone="ok">ok</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <EmptyState title="Нет данных" text="Импортируйте техкарту" />}
        </div>
      )}
    </div>
  )
}

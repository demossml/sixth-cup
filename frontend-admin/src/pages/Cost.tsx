import { useMemo, useState } from 'react'
import { useApi } from '../api/useApi'
import { api } from '../api/client'
import {
  PageHeader, Card, EmptyState, Badge, Button, Input, Select, Field,
  ErrorBox, Skeleton, Tabs, useToast, cx,
} from '../ui/kit'
import { Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import { csvName, downloadCsv } from '../lib/csv'

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

export default function Cost() {
  const [tab, setTab] = useState<'ingredients' | 'recipes' | 'summary'>('ingredients')
  const cats = useApi<{ categories: Cat[] }>('/cost/categories')
  const ings = useApi<{ ingredients: Ing[] }>('/cost/ingredients')
  const recipes = useApi<{ recipes: Recipe[] }>('/cost/recipes')
  const summary = useApi<{ rows: SummaryRow[] }>(tab === 'summary' ? '/cost/summary' : null)
  const toast = useToast()
  const reloadAll = () => {
    cats.reload(); ings.reload(); recipes.reload(); summary.reload()
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Себестоимость"
        subtitle="Ингредиенты, техкарты порций, наценка и маржа. ИИ только предлагает черновик."
        actions={
          <Button variant="ghost" onClick={reloadAll}><RefreshCw size={16} /> Обновить</Button>
        }
      />
      <Tabs
        value={tab}
        onChange={(v) => setTab(v as typeof tab)}
        items={[
          { key: 'ingredients', label: 'Ингредиенты' },
          { key: 'recipes', label: 'Рецепты' },
          { key: 'summary', label: 'Сводка' },
        ]}
      />
      {tab === 'ingredients' && (
        <IngredientsTab
          cats={cats.data?.categories || []}
          ings={ings.data?.ingredients || []}
          loading={ings.loading}
          error={ings.error}
          onChange={() => { ings.reload(); cats.reload() }}
        />
      )}
      {tab === 'recipes' && (
        <RecipesTab
          ings={(ings.data?.ingredients || []).filter((i) => i.complete && i.active)}
          allIngs={ings.data?.ingredients || []}
          recipes={recipes.data?.recipes || []}
          loading={recipes.loading}
          error={recipes.error}
          onChange={() => recipes.reload()}
        />
      )}
      {tab === 'summary' && (
        <SummaryTab
          rows={summary.data?.rows || []}
          loading={summary.loading}
          error={summary.error}
        />
      )}
    </div>
  )
}

function IngredientsTab({
  cats, ings, loading, error, onChange,
}: {
  cats: Cat[]; ings: Ing[]; loading: boolean; error: string; onChange: () => void
}) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [catId, setCatId] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [form, setForm] = useState({
    name: '', categoryId: '', unit: 'ml', packQty: '1000', packPriceRub: '', comment: '',
  })
  const [newCat, setNewCat] = useState('')
  const filtered = useMemo(() => {
    return ings.filter((i) => {
      if (q && !i.name.toLowerCase().includes(q.toLowerCase())) return false
      if (catId && String(i.categoryId) !== catId) return false
      return true
    })
  }, [ings, q, catId])

  const saveIng = async () => {
    try {
      await api('/cost/ingredients', {
        method: 'POST',
        body: {
          name: form.name.trim(),
          categoryId: Number(form.categoryId || cats[0]?.id),
          unit: form.unit,
          packQty: Number(form.packQty),
          packPriceRub: form.packPriceRub === '' ? null : Number(form.packPriceRub),
          comment: form.comment || null,
        },
      })
      toast.push('Ингредиент добавлен')
      setShowForm(false)
      setForm({ name: '', categoryId: '', unit: 'ml', packQty: '1000', packPriceRub: '', comment: '' })
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
        <Button onClick={() => setShowForm(true)}><Plus size={16} /> Ингредиент</Button>
        <Button variant="ghost" onClick={() => setAiOpen(true)}><Sparkles size={16} /> Заполнить с ИИ</Button>
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
          text="Добавьте молоко, кофе, стаканы и крышки с фасовкой и ценой — от них считается себес."
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
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr key={i.id} className="border-t border-line">
                  <td className="p-2 font-medium">{i.name}</td>
                  <td className="p-2">{i.categoryName}</td>
                  <td className="p-2">{i.packQty} {UNIT_LABEL[i.unit] || i.unit}</td>
                  <td className="p-2">{i.packPriceRub ?? '—'}</td>
                  <td className="p-2">{i.unitPriceRub != null ? i.unitPriceRub.toFixed(4) : '—'}</td>
                  <td className="p-2">{i.complete ? <Badge tone="ok">готов</Badge> : <Badge tone="warn">нет цены</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showForm && (
        <Card className="p-4 space-y-3 max-w-lg">
          <div className="font-semibold">Новый ингредиент</div>
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
            <Field label="Цена ₽"><Input value={form.packPriceRub} onChange={(e) => setForm({ ...form, packPriceRub: e.target.value })} /></Field>
          </div>
          <Field label="Комментарий"><Input value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} /></Field>
          <div className="flex gap-2">
            <Button onClick={saveIng}>Сохранить</Button>
            <Button variant="ghost" onClick={() => setShowForm(false)}>Отмена</Button>
          </div>
        </Card>
      )}
      {aiOpen && <AiPanel onClose={() => setAiOpen(false)} onDone={() => { setAiOpen(false); onChange() }} />}
    </div>
  )
}

function AiPanel({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [text, setText] = useState('Молоко 3,2% 1 л — 95 ₽\nСтаканы 200 мл, 50 шт — 310 ₽\nКрышки 80 мм, 50 шт — 190 ₽\nСироп ваниль 0,7 л — 640 ₽')
  const [busy, setBusy] = useState(false)
  const [items, setItems] = useState<{
    name: string; category: string; unit: string; packQty: number
    packPriceRub: number | null; confidence: string; note?: string; selected?: boolean
  }[]>([])

  const parse = async () => {
    setBusy(true)
    try {
      const res = await api<{ items: typeof items }>('/cost/ai/parse', {
        method: 'POST',
        body: { text },
      })
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
    <Card className="p-4 space-y-3 border-brand">
      <div className="flex justify-between items-center">
        <div className="font-semibold flex items-center gap-2"><Sparkles size={18} /> Заполнить с ИИ</div>
        <Button variant="ghost" onClick={onClose}>Закрыть</Button>
      </div>
      <p className="text-sm text-ink-secondary">Вставьте прайс текстом. Проверьте таблицу — в базу попадёт только выбранное.</p>
      <textarea
        className="w-full min-h-[100px] rounded-xl border border-line p-3 text-sm"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Button disabled={busy} onClick={parse}>{busy ? 'Разбираю…' : 'Извлечь'}</Button>
      {!!items.length && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-secondary">
                <th className="p-1"></th>
                <th className="p-1">Название</th>
                <th className="p-1">Кат.</th>
                <th className="p-1">Фас.</th>
                <th className="p-1">₽</th>
                <th className="p-1">Увер.</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={idx} className="border-t border-line">
                  <td className="p-1">
                    <input
                      type="checkbox"
                      checked={it.selected !== false}
                      onChange={(e) => {
                        const next = [...items]
                        next[idx] = { ...it, selected: e.target.checked }
                        setItems(next)
                      }}
                    />
                  </td>
                  <td className="p-1">{it.name}</td>
                  <td className="p-1">{it.category}</td>
                  <td className="p-1">{it.packQty} {UNIT_LABEL[it.unit] || it.unit}</td>
                  <td className="p-1">{it.packPriceRub ?? '—'}</td>
                  <td className="p-1">
                    {it.confidence === 'low' ? <Badge tone="warn">проверить</Badge> : <Badge tone="ok">ok</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button className="mt-2" onClick={commit}>Добавить выбранные</Button>
        </div>
      )}
    </Card>
  )
}

function RecipesTab({
  ings, allIngs, recipes, loading, error, onChange,
}: {
  ings: Ing[]; allIngs: Ing[]; recipes: Recipe[]; loading: boolean; error: string; onChange: () => void
}) {
  const toast = useToast()
  const [sel, setSel] = useState<number | null>(recipes[0]?.id ?? null)
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
      await api(`/cost/recipes/${sel}`, {
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
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    }
  }

  const addLine = () => {
    const id = Number(addIngId)
    const ing = ings.find((i) => i.id === id)
    if (!ing) {
      toast.push('Выберите ингредиент с ценой и фасовкой', 'neutral')
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
        complete: true,
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
            )}
          >
            <div className="font-medium">{r.name}</div>
            <div className="text-xs text-ink-secondary">
              {r.costRub != null ? `${r.costRub.toFixed(2)} ₽` : '—'}
              {r.missingPrices ? ' · нет цен' : ''}
            </div>
          </button>
        ))}
        {!recipes.length && !loading && <EmptyState title="Нет рецептов" text="Создайте техкарту порции" />}
      </Card>
      <div className="space-y-3">
        {!current ? (
          <EmptyState title="Выберите рецепт" text="Или создайте новый" />
        ) : (
          <>
            <Card className="p-4 space-y-3">
              <Field label="Название"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Наценка %"><Input value={markup} onChange={(e) => setMarkup(e.target.value)} /></Field>
                <Field label="Розница ₽ (утв.)"><Input value={retail} onChange={(e) => setRetail(e.target.value)} placeholder="авто" /></Field>
              </div>
              <div className="flex flex-wrap gap-3 text-sm">
                <Badge tone="brand">Себес {current.costRub != null ? `${current.costRub.toFixed(2)} ₽` : '—'}</Badge>
                <Badge tone="neutral">Расч. розница {current.retailCalcRub != null ? `${current.retailCalcRub.toFixed(2)} ₽` : '—'}</Badge>
                <Badge tone={current.marginPct != null && current.marginPct < 50 ? 'warn' : 'ok'}>
                  Маржа {current.marginPct != null ? `${current.marginPct}%` : '—'}
                </Badge>
              </div>
              {current.missingPrices && <Badge tone="warn">У части сырья нет цены</Badge>}
            </Card>
            <Card className="p-4 space-y-2">
              <div className="font-medium">Состав порции (стакан, крышка, молоко…)</div>
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
                  {lines.map((l, idx) => (
                    <tr key={idx} className="border-t border-line">
                      <td className="p-1">{l.ingredientName || allIngs.find((i) => i.id === l.ingredientId)?.name}</td>
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
                        {UNIT_LABEL[l.unit || ''] || ''}
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
                      <td className="p-1">{l.lineSumRub != null ? `${l.lineSumRub.toFixed(2)} ₽` : '—'}</td>
                      <td className="p-1">
                        <button type="button" onClick={() => setLines(lines.filter((_, i) => i !== idx))}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex flex-wrap gap-2 items-end">
                <Field label="Ингредиент (только полные)">
                  <Select value={addIngId} onChange={(e) => setAddIngId(e.target.value)}>
                    <option value="">—</option>
                    {ings.map((i) => (
                      <option key={i.id} value={i.id}>{i.name}</option>
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
              <Button onClick={saveRecipe}>Сохранить рецепт</Button>
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
      rows.map((r) => [
        r.name,
        r.costRub ?? '',
        r.markupPct,
        r.retailRub ?? '',
        r.marginPct ?? '',
        r.warnings.join(';'),
      ]),
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
                <tr key={r.id} className="border-t border-line">
                  <td className="p-2 font-medium">{r.name}</td>
                  <td className="p-2">{r.costRub != null ? r.costRub.toFixed(2) : '—'}</td>
                  <td className="p-2">{r.markupPct}</td>
                  <td className="p-2">{r.retailRub != null ? r.retailRub.toFixed(2) : '—'}</td>
                  <td className="p-2">{r.marginPct != null ? r.marginPct : '—'}</td>
                  <td className="p-2">{r.missingPrices ? <Badge tone="warn">нет цен</Badge> : <Badge tone="ok">ok</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <EmptyState title="Нет данных" text="Создайте рецепты" />}
        </div>
      )}
    </div>
  )
}

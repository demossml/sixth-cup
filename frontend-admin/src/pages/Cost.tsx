import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApi } from '../api/useApi'
import { api, tokenStore } from '../api/client'
import {
  PageHeader, Card, EmptyState, Badge, Button, Input, Select, Field,
  ErrorBox, Skeleton, Tabs, useToast, cx, DataTable, type Column, ConfirmDialog,
} from '../ui/kit'
import { Plus, RefreshCw, Sparkles, Trash2, Upload, Pencil } from 'lucide-react'
import { csvName, downloadCsv } from '../lib/csv'
import { initialCostTab, shouldAutoFocusMissing, type CostTabKey } from '../lib/costTabs'
import TechCardsTab from '../components/cost/TechCardsTab'
import SignalsTab from '../components/cost/SignalsTab'

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
  const [params, setParams] = useSearchParams()
  // ?focus=missing — из импорта техкарты и внешних ссылок: сразу режим дозаполнения.
  const focusMissing = params.get('focus') === 'missing'
  const [tab, setTab] = useState<CostTabKey>(initialCostTab(params.get('focus')))
  // Переход «сигнал → карта»: держим id, чтобы вкладка открыла нужную техкарту.
  const [openCardId, setOpenCardId] = useState<number | null>(null)
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
  const [missingSignal, setMissingSignal] = useState(0)
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

  /** Переход на ?focus=missing в уже открытой странице: вкладка + фильтр «Без цены». */
  useEffect(() => {
    if (!focusMissing) return
    tabTouched.current = true
    setTab('fill')
    setMissingSignal((n) => n + 1)
  }, [focusMissing])

  /** Ссылка «без цены» должна переживать перезагрузку и шариться. */
  const focusMissingInUrl = () => {
    const next = new URLSearchParams(params)
    next.set('focus', 'missing')
    setParams(next, { replace: true })
  }

  const [uploadOpen, setUploadOpen] = useState(false)
  const [importInfo, setImportInfo] = useState<{ count: number; names: string[] } | null>(null)

  /** Импорт завершён: обновляем справочник и рецепты, ведём кассира к незаполненным ценам. */
  const onImported = (res: { missingIngredientNames?: string[] }) => {
    ings.reload(); cats.reload(); recipes.reload()
    setUploadOpen(false)
    const names = res.missingIngredientNames
    // undefined — источник не сообщает о ценах (ИИ-прайс): баннер не показываем.
    setImportInfo(names === undefined ? null : { count: names.length, names })
    selectTab('fill')
    if (names && names.length) {
      setMissingSignal((n) => n + 1)
      const next = new URLSearchParams(params)
      next.set('focus', 'missing')
      setParams(next, { replace: true })
    }
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
                <Button size="sm" onClick={() => { focusMissingInUrl(); selectTab('fill'); setMissingSignal((n) => n + 1) }}>
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
          { key: 'tech', label: 'Техкарты' },
          { key: 'signals', label: 'Сигналы' },
          { key: 'fill', label: 'Дозаполнить', count: missingCount || null },
          { key: 'recipes', label: 'Старые рецепты' },
          { key: 'summary', label: 'Сводка' },
        ]}
      />
      {tab === 'tech' && (
        <TechCardsTab
          initialCardId={openCardId ?? undefined}
          onOpenSignals={() => selectTab('signals')}
        />
      )}
      {tab === 'signals' && (
        <SignalsTab
          onOpenCard={(id) => {
            setOpenCardId(id)
            selectTab('tech')
          }}
        />
      )}
      {tab === 'fill' && (
        <FillTab
          cats={cats.data?.categories || []}
          ings={ingredientList}
          loading={ings.loading}
          error={ings.error}
          focusMissingSignal={missingSignal}
          onChange={() => { ings.reload(); cats.reload(); recipes.reload() }}
          onUpload={() => setUploadOpen(true)}
        />
      )}
      {tab === 'recipes' && (
        <RecipesTab
          ings={ings.data?.ingredients || []}
          recipes={recipes.data?.recipes || []}
          loading={recipes.loading}
          error={recipes.error}
          onChange={() => { recipes.reload(); ings.reload() }}
          onUpload={() => setUploadOpen(true)}
        />
      )}
      {tab === 'summary' && (
        <SummaryTab
          rows={summary.data?.rows || []}
          loading={summary.loading}
          error={summary.error}
          onUpload={() => setUploadOpen(true)}
        />
      )}
    </div>
  )
}

/**
 * Форма ингредиента: bottom sheet на телефоне, карточка по центру на десктопе.
 * Цена закупки — единственное поле, которое закрывает «красные» позиции в техкартах.
 */
function IngredientSheet({
  cats, initial, onClose, onSaved,
}: {
  cats: Cat[]; initial: Ing | null; onClose: () => void; onSaved: () => void
}) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    categoryId: initial ? String(initial.categoryId) : '',
    unit: initial?.unit ?? 'ml',
    packQty: initial ? String(initial.packQty) : '1000',
    packPriceRub: initial?.packPriceRub != null ? String(initial.packPriceRub) : '',
    comment: initial?.comment ?? '',
  })

  const canSave = form.name.trim().length > 0 && Number(form.packQty) > 0

  const save = async () => {
    if (!canSave) {
      toast.push('Укажите название и фасовку', 'neutral')
      return
    }
    setBusy(true)
    try {
      const body = {
        name: form.name.trim(),
        categoryId: Number(form.categoryId || cats[0]?.id),
        unit: form.unit,
        packQty: Number(form.packQty),
        packPriceRub: form.packPriceRub.trim() === '' ? null : Number(form.packPriceRub),
        comment: form.comment.trim() || null,
      }
      if (initial) {
        await api(`/cost/ingredients/${initial.id}`, { method: 'PUT', body })
        toast.push('Сохранено')
      } else {
        await api('/cost/ingredients', { method: 'POST', body })
        toast.push('Ингредиент добавлен')
      }
      onSaved()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!initial) return
    setBusy(true)
    try {
      await api(`/cost/ingredients/${initial.id}`, { method: 'DELETE' })
      toast.push('Удалено')
      setConfirmDelete(false)
      onSaved()
    } catch (e) {
      // 409 приходит текстом сервера («используется в рецептах: …») — показываем как есть.
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
      setConfirmDelete(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
        onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={initial ? `Ингредиент ${initial.name}` : 'Новый ингредиент'}
          className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 shadow-soft sm:rounded-2xl sm:p-5"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-base font-bold">{initial ? 'Ингредиент' : 'Новый ингредиент'}</div>
            <Button variant="ghost" onClick={onClose} disabled={busy}>Закрыть</Button>
          </div>
          <div className="space-y-3">
            <Field label="Название">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus={!initial} />
            </Field>
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
              <Field label="Фасовка">
                <Input
                  inputMode="decimal"
                  value={form.packQty}
                  onChange={(e) => setForm({ ...form, packQty: e.target.value })}
                />
              </Field>
              <Field label="Цена ₽">
                <Input
                  inputMode="decimal"
                  value={form.packPriceRub}
                  onChange={(e) => setForm({ ...form, packPriceRub: e.target.value })}
                  placeholder="для себеса"
                />
              </Field>
            </div>
            <Field label="Комментарий">
              <Input value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} />
            </Field>
            {form.packPriceRub.trim() === '' && (
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Без цены закупки позиция не входит в себестоимость.
              </div>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={save} disabled={!canSave} loading={busy}>Сохранить</Button>
            <Button variant="secondary" onClick={onClose} disabled={busy}>Отмена</Button>
            {initial && (
              <Button variant="danger" className="sm:ml-auto" onClick={() => setConfirmDelete(true)} disabled={busy}>
                <Trash2 size={15} /> Удалить
              </Button>
            )}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title={`Удалить «${initial?.name ?? ''}»?`}
        confirmLabel="Удалить"
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      >
        Если ингредиент входит в рецепты, удаление будет отклонено — цену проще обнулить.
      </ConfirmDialog>
    </>
  )
}

/** Компактный чип-фильтр (дизайн §A3): «Без цены» / «Все» / категории. */
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition',
        active
          ? 'border-brand bg-brand-soft font-semibold text-brand'
          : 'border-line bg-card text-ink-secondary hover:bg-surface-2',
      )}
    >
      {children}
    </button>
  )
}

function FillTab({
  cats, ings, loading, error, onChange, focusMissingSignal = 0, onUpload,
}: {
  cats: Cat[]; ings: Ing[]; loading: boolean; error: string; onChange: () => void
  /** Растёт, когда кассир просит показать позиции без цены (импорт, deep link). */
  focusMissingSignal?: number
  onUpload?: () => void
}) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [catId, setCatId] = useState('')
  const [onlyMissing, setOnlyMissing] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<Ing | null>(null)
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
    setEditing(i)
    setSheetOpen(true)
  }

  const openNew = () => {
    setEditing(null)
    setSheetOpen(true)
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

  const missingHere = useMemo(() => ings.filter((i) => !i.complete).length, [ings])
  const withPrice = ings.length - missingHere

  const columns: Column<Ing>[] = [
    {
      key: 'name',
      header: 'Название',
      primary: true,
      render: (i) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{i.name}</span>
          {!i.complete && <Badge tone="bad">нет цены</Badge>}
        </span>
      ),
    },
    { key: 'cat', header: 'Категория', render: (i) => i.categoryName },
    { key: 'pack', header: 'Фасовка', render: (i) => `${i.packQty} ${UNIT_LABEL[i.unit] || i.unit}` },
    {
      key: 'price',
      header: '₽/фас.',
      align: 'right',
      render: (i) => (i.packPriceRub != null ? i.packPriceRub : <span className="text-red-700">—</span>),
    },
    {
      key: 'unit',
      header: '₽/ед.',
      align: 'right',
      hideOnPhone: true,
      render: (i) => (i.unitPriceRub != null ? i.unitPriceRub.toFixed(4) : '—'),
    },
    { key: 'status', header: 'Статус', hideOnPhone: true, render: (i) => <Badge tone={i.complete ? 'ok' : 'bad'}>{i.complete ? 'готов' : 'нет цены'}</Badge> },
    {
      key: 'act',
      header: '',
      hideOnPhone: true,
      render: (i) => (
        <span className="whitespace-nowrap">
          <button type="button" title="Изменить" onClick={(e) => { e.stopPropagation(); openEdit(i) }}><Pencil size={14} /></button>
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Поиск"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Молоко, стакан…" /></Field>
        <Button className="sm:ml-auto" onClick={openNew}>
          <Plus size={16} /> Ингредиент
        </Button>
      </div>

      {/* Липкие фильтры: на телефоне таблица не главный UI. */}
      <div className="sticky top-0 z-10 -mx-1 space-y-2 bg-[var(--page)]/95 px-1 py-2 backdrop-blur">
        <div className="flex flex-wrap gap-1.5">
          <Chip active={onlyMissing} onClick={() => setOnlyMissing(true)}>Без цены {missingHere}</Chip>
          <Chip active={!onlyMissing} onClick={() => setOnlyMissing(false)}>Все {ings.length}</Chip>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          <Chip active={!catId} onClick={() => setCatId('')}>Все категории</Chip>
          {cats.map((c) => (
            <Chip key={c.id} active={catId === String(c.id)} onClick={() => setCatId(String(c.id))}>{c.name}</Chip>
          ))}
        </div>
      </div>

      <Card className="flex flex-wrap items-end gap-2 p-3">
        <Field label="Новая категория">
          <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Напр. Маршмеллоу" />
        </Field>
        <Button variant="ghost" onClick={addCategory}><Plus size={16} /> Категория</Button>
      </Card>
      {error && <ErrorBox message={error} />}
      {loading && !ings.length ? <Skeleton className="h-40" /> : null}
      {!loading && !filtered.length ? (
        <EmptyState
          title={onlyMissing ? 'Все цены заполнены' : 'Справочник пуст'}
          action={onUpload && <Button onClick={onUpload}><Upload size={16} /> Загрузить</Button>}
          text={
            onlyMissing
              ? `Позиций без цены нет — в себестоимость входят все ${withPrice} ингредиентов. Импортируйте техкарту кнопкой «Загрузить».`
              : 'Импортируйте Excel-техкарту или добавьте молоко, кофе, стаканы вручную.'
          }
        />
      ) : (
        <DataTable
          rows={filtered}
          columns={columns}
          rowKey={(i) => i.id}
          onRowClick={openEdit}
          rowClassName={(i) => (i.complete ? undefined : '!bg-red-50')}
        />
      )}
      {sheetOpen && (
        <IngredientSheet
          cats={cats}
          initial={editing}
          onClose={() => setSheetOpen(false)}
          onSaved={() => { setSheetOpen(false); onChange() }}
        />
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
  ings, recipes, loading, error, onChange, onUpload,
}: {
  ings: Ing[]; recipes: Recipe[]; loading: boolean; error: string; onChange: () => void
  onUpload?: () => void
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
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

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
    setBusy(true)
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
    } finally {
      setBusy(false)
    }
  }

  const deleteRecipe = async () => {
    if (!sel) return
    setBusy(true)
    try {
      await api(`/cost/recipes/${sel}`, { method: 'DELETE' })
      setSel(null)
      toast.push('Рецепт удалён')
      onChange()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Ошибка', 'bad')
    } finally {
      setBusy(false)
      setConfirmDelete(false)
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
    <>
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* Телефон: сначала список на весь экран, редактор открывается отдельно. */}
        <Card className={cx('space-y-1 p-2 lg:max-h-[70vh] lg:overflow-auto', sel !== null && 'hidden lg:block')}>
          <Button className="mb-2 w-full" onClick={createRecipe}><Plus size={16} /> Рецепт</Button>
          {loading && <Skeleton className="h-20" />}
          {error && <ErrorBox message={error} />}
          {recipes.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => openRecipe(r)}
              className={cx(
                'w-full rounded-xl px-3 py-2.5 text-left text-sm',
                sel === r.id ? 'bg-brand-soft text-brand' : 'hover:bg-surface-2',
                r.missingPrices && 'border-l-2 border-red-500',
              )}
            >
              <div className="font-medium">{r.name}</div>
              <div className="text-xs text-ink-secondary">
                {r.costRub != null ? `${r.costRub.toFixed(2)} ₽` : 'себес —'}
                {r.missingPrices && ' · есть позиции без цены'}
              </div>
            </button>
          ))}
          {!recipes.length && !loading && (
            <EmptyState
              title="Нет рецептов"
              text="Загрузите техкарту — рецепты создадутся сами."
              action={onUpload && <Button onClick={onUpload}><Upload size={16} /> Загрузить</Button>}
            />
          )}
        </Card>

        <div className={cx('space-y-3', sel === null && 'hidden lg:block')}>
          {!current ? (
            <EmptyState title="Выберите рецепт" text="Или импортируйте техкарту кнопкой «Загрузить»" />
          ) : (
            <>
              <Button variant="ghost" className="lg:hidden" onClick={() => setSel(null)}>← К списку</Button>

              <Card className="space-y-3 p-4">
                <Field label="Название"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
                <div className="flex flex-wrap gap-2">
                  <Badge tone="brand">Себес {current.costRub != null ? `${current.costRub.toFixed(2)} ₽` : '—'}</Badge>
                  <Badge tone="neutral">Расчёт {current.retailCalcRub != null ? `${current.retailCalcRub.toFixed(2)} ₽` : '—'}</Badge>
                  <Badge tone={current.marginPct != null && current.marginPct < 50 ? 'warn' : 'ok'}>
                    Маржа {current.marginPct != null ? `${current.marginPct}%` : '—'}
                  </Badge>
                </div>
                {current.missingPrices && (
                  <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    Красные строки без цены закупки не входят в себестоимость — укажите цену в «Дозаполнить».
                  </div>
                )}
                <Button variant="danger" className="w-full sm:w-auto" onClick={() => setConfirmDelete(true)} disabled={busy}>
                  <Trash2 size={15} /> Удалить рецепт
                </Button>
              </Card>

              <Card className="space-y-3 p-4">
                <div className="font-medium">Состав (напиток + стакан + крышка + …)</div>
                <div className="space-y-2">
                  {lines.map((l, idx) => {
                    const ing = ings.find((i) => i.id === l.ingredientId)
                    const incomplete = !(l.complete ?? ing?.complete)
                    const sum = l.lineSumRub != null ? `${l.lineSumRub.toFixed(2)} ₽` : '—'
                    return (
                      <div
                        key={idx}
                        className={cx('rounded-xl border border-line p-2.5', incomplete && 'border-red-300 !bg-red-50')}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className={cx('text-sm font-medium', incomplete && 'text-red-800')}>
                              {l.ingredientName || ing?.name}
                            </div>
                            <div className="text-xs text-ink-secondary">
                              {incomplete ? 'нет цены — не входит в себес' : sum}
                            </div>
                          </div>
                          <button
                            type="button"
                            aria-label={`Убрать ${l.ingredientName || ing?.name || 'строку'}`}
                            onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                        <div className="mt-2 flex flex-wrap items-end gap-2">
                          <Field label="Кол-во">
                            <Input
                              className="w-24"
                              inputMode="decimal"
                              value={String(l.qty)}
                              onChange={(e) => {
                                const next = [...lines]
                                next[idx] = { ...l, qty: Number(e.target.value) || 0 }
                                setLines(next)
                              }}
                            />
                            <span className="ml-1 text-xs text-ink-secondary">
                              {UNIT_LABEL[l.unit || ing?.unit || ''] || ''}
                            </span>
                          </Field>
                          <Field label="Роль">
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
                          </Field>
                        </div>
                      </div>
                    )
                  })}
                  {!lines.length && (
                    <div className="rounded-xl bg-surface-2 px-3 py-3 text-sm text-ink-secondary">
                      Состав пуст — добавьте молоко, кофе, стакан и крышку.
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
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
                  <Field label="Кол-во">
                    <Input className="w-24" inputMode="decimal" value={addQty} onChange={(e) => setAddQty(e.target.value)} />
                  </Field>
                  <Field label="Роль">
                    <Select value={addRole} onChange={(e) => setAddRole(e.target.value as 'base' | 'optional')}>
                      <option value="base">база</option>
                      <option value="optional">по желанию</option>
                    </Select>
                  </Field>
                  <Button variant="secondary" onClick={addLine}><Plus size={16} /> Строка</Button>
                </div>
              </Card>

              {/* На телефоне панель сохранения липнет к низу: наценка и розница всегда под рукой. */}
              <div className="sticky bottom-0 z-10 -mx-1 mt-1 rounded-t-2xl border-t border-line bg-[var(--page)]/95 px-1 pb-2 pt-2 backdrop-blur lg:static lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0">
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Наценка %">
                    <Input className="w-24" inputMode="decimal" value={markup} onChange={(e) => setMarkup(e.target.value)} />
                  </Field>
                  <Field label="Розница ₽">
                    <Input className="w-28" inputMode="decimal" value={retail} onChange={(e) => setRetail(e.target.value)} placeholder="утверждённая" />
                  </Field>
                  <Button className="w-full sm:ml-auto sm:w-auto" onClick={saveRecipe} loading={busy}>Сохранить</Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`Удалить рецепт «${name}»?`}
        confirmLabel="Удалить"
        danger
        busy={busy}
        onConfirm={() => void deleteRecipe()}
        onCancel={() => setConfirmDelete(false)}
      >
        Рецепт исчезнет из сводки. Ингредиенты и их цены останутся в справочнике.
      </ConfirmDialog>
    </>
  )
}


function SummaryTab({
  rows, loading, error, onUpload,
}: {
  rows: SummaryRow[]; loading: boolean; error: string; onUpload?: () => void
}) {
  const [onlyProblems, setOnlyProblems] = useState(false)
  const problems = useMemo(() => rows.filter((r) => r.missingPrices), [rows])
  const visible = onlyProblems ? problems : rows

  const exportCsv = () => {
    downloadCsv(
      csvName('cost-summary'),
      ['name', 'cost', 'markup', 'retail', 'margin', 'warn'],
      visible.map((r) => [r.name, r.costRub ?? '', r.markupPct, r.retailRub ?? '', r.marginPct ?? '', r.warnings.join(';')]),
    )
  }

  const columns: Column<SummaryRow>[] = [
    {
      key: 'name',
      header: 'Рецепт',
      primary: true,
      render: (r) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{r.name}</span>
          {r.missingPrices && <Badge tone="bad">дозаполнить</Badge>}
        </span>
      ),
    },
    {
      key: 'cost',
      header: 'Себес',
      align: 'right',
      render: (r) => (r.costRub != null ? `${r.costRub.toFixed(2)} ₽` : '—'),
    },
    { key: 'markup', header: 'Наценка %', align: 'right', render: (r) => r.markupPct },
    {
      key: 'retail',
      header: 'Розница',
      align: 'right',
      hideOnPhone: true,
      render: (r) => (r.retailRub != null ? `${r.retailRub.toFixed(2)} ₽` : '—'),
    },
    {
      key: 'margin',
      header: 'Маржа %',
      align: 'right',
      render: (r) => (
        <span className={cx(r.marginPct != null && r.marginPct < 50 && 'text-amber-700')}>
          {r.marginPct != null ? `${r.marginPct}%` : '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Статус',
      hideOnPhone: true,
      render: (r) => (r.missingPrices ? <Badge tone="bad">дозаполнить</Badge> : <Badge tone="ok">ok</Badge>),
    },
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip active={!onlyProblems} onClick={() => setOnlyProblems(false)}>Все {rows.length}</Chip>
        <Chip active={onlyProblems} onClick={() => setOnlyProblems(true)}>Только проблемы {problems.length}</Chip>
        <Button variant="ghost" className="ml-auto" onClick={exportCsv}>CSV</Button>
      </div>
      {error && <ErrorBox message={error} />}
      {loading ? (
        <Skeleton className="h-32" />
      ) : (
        <DataTable
          rows={visible}
          columns={columns}
          rowKey={(r) => r.id}
          rowClassName={(r) => (r.missingPrices ? '!bg-red-50' : undefined)}
          empty={
            <EmptyState
              title={onlyProblems ? 'Проблем нет' : 'Нет данных'}
              text={onlyProblems ? 'У всех рецептов заполнены цены.' : 'Импортируйте техкарту кнопкой «Загрузить».'}
              action={!onlyProblems && onUpload && <Button onClick={onUpload}><Upload size={16} /> Загрузить</Button>}
            />
          }
        />
      )}
    </div>
  )
}

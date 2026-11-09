import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowDown, ArrowLeft, ArrowUp, Check, Download, Eye, EyeOff, Grid3x3, Image as ImageIcon, Layers, ListTree,
  Loader2, Minus, Palette, Plus, RefreshCw, Search, Trash2, Type, Undo2, X,
} from 'lucide-react'
import { api, tokenStore } from '../api/client'
import { useApi } from '../api/useApi'
import { ago } from '../lib/format'
import {
  DEFAULT_THEME,
  LAYOUT_FORMATS,
  THEME_PRESETS,
  blockLabel,
  docSnapshot,
  driftBanner,
  formatLabel,
  localDrift,
  moveBlock,
  newBlock,
  productBlock,
  reindex,
  resolvePreview,
  toggleHidden,
  type BlockType,
  type CatalogProduct,
  type LayoutFormat,
  type MenuBlock,
  type MenuDoc,
  type MenuTheme,
} from '../lib/menuLayout'
import { Badge, Banner, Button, ConfirmDialog, Drawer, cx, ErrorBox, Field, Input, Select, Spinner, useToast } from '../ui/kit'
import MenuSheet from '../components/menuLayout/MenuSheet'

type ServerLayout = {
  id: number
  title: string
  format: LayoutFormat
  status: 'draft' | 'ready'
  theme: MenuTheme
  priceMode: 'live' | 'frozen'
  frozenAt: number | null
  updatedAt: number
  stats: { pages: number; products: number; warnings: number }
  drift: { blockId: string; title: string; from: number | null; to: number | null }[]
  blockers: { blockId: string; code: string; text: string }[]
  doc: MenuDoc
  formatHint: { label: string; mm: string }
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

/** «до 12 нояб.» — человеку важна дата, а не секунды. */
const fmtFrozen = (ms: number | null): string =>
  ms ? ` с ${new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}` : ''
type MobileTab = 'preview' | 'content' | 'design' | 'export'
type LeftTab = 'catalog' | 'layers'
type RightTab = 'design' | 'layer'

const AUTOSAVE_MS = 800
const UNDO_LIMIT = 10

/**
 * Редактор макета. Три зоны на десктопе, четыре вкладки на телефоне — но состояние одно:
 * любой путь ведёт к тому же PUT /menu-layouts/:id (автосохранение через 800 мс).
 */
export default function MenuLayoutEditor() {
  const { id } = useParams()
  const toast = useToast()
  const numericId = Number(id)

  const { data, error, loading, reload } = useApi<{ layout: ServerLayout }>(Number.isFinite(numericId) ? `/menu-layouts/${numericId}` : null)
  const catalog = useApi<{ products: CatalogProduct[] }>('/products')
  const cats = useApi<{ categories: { id: number; name: string }[] }>('/categories')

  const [doc, setDoc] = useState<MenuDoc | null>(null)
  const [theme, setTheme] = useState<MenuTheme>(DEFAULT_THEME)
  const [title, setTitle] = useState('')
  const [status, setStatus] = useState<'draft' | 'ready'>('draft')
  const [frozenAt, setFrozenAt] = useState<number | null>(null)
  const [priceMode, setPriceMode] = useState<'live' | 'frozen'>('live')
  const [save, setSave] = useState<SaveState>('idle')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [drift, setDrift] = useState<ServerLayout['drift']>([])
  const [serverStats, setServerStats] = useState<ServerLayout['stats'] | null>(null)

  const [pageIdx, setPageIdx] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [leftTab, setLeftTab] = useState<LeftTab>('catalog')
  const [rightTab, setRightTab] = useState<RightTab>('design')
  const [mobileTab, setMobileTab] = useState<MobileTab>('preview')
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState<number | 'all'>('all')
  const [zoom, setZoom] = useState(1)
  const [showGrid, setShowGrid] = useState(false)
  const [showSafe, setShowSafe] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [formatOpen, setFormatOpen] = useState(false)

  const undoStack = useRef<MenuDoc[]>([])
  const hydrated = useRef<number | null>(null)
  const lastSaved = useRef('')

  useEffect(() => {
    const layout = data?.layout
    if (!layout || hydrated.current === layout.id) return
    hydrated.current = layout.id
    setDoc(docSnapshot(layout.doc))
    setTheme({ ...DEFAULT_THEME, ...layout.theme })
    setTitle(layout.title)
    setStatus(layout.status)
    setPriceMode(layout.priceMode)
    setFrozenAt(layout.frozenAt)
    setDrift(layout.drift)
    setServerStats(layout.stats)
    lastSaved.current = JSON.stringify({ title: layout.title, theme: layout.theme, doc: docSnapshot(layout.doc) })
    setSave('idle')
  }, [data])

  const products = catalog.data?.products ?? []
  const categories = cats.data?.categories ?? []
  const page = doc?.pages[Math.min(pageIdx, (doc?.pages.length ?? 1) - 1)] ?? null

  const previewDoc = useMemo(() => (doc ? resolvePreview(doc, products, priceMode) : null), [doc, products, priceMode])
  const previewPage = previewDoc?.pages[Math.min(pageIdx, (previewDoc.pages.length || 1) - 1)] ?? null
  const selected = page?.blocks.find((b) => b.id === selectedId) ?? null

  const liveDrift = useMemo(() => (doc ? localDrift(doc, products) : []), [doc, products])

  const blockers = useMemo(() => {
    if (!previewDoc) return [] as { blockId: string; code: string; text: string }[]
    const out: { blockId: string; code: string; text: string }[] = []
    for (const p of previewDoc.pages) {
      for (const b of p.blocks) {
        for (const w of b.warnings ?? []) {
          out.push({ blockId: b.id, code: w === 'нет цены' ? 'no_price' : w === 'позиции больше нет в каталоге' ? 'missing_product' : 'notice', text: w })
        }
      }
    }
    return out
  }, [previewDoc])

  const mutate = useCallback((next: MenuDoc) => {
    setDoc((prev) => {
      if (prev) {
        undoStack.current.push(docSnapshot(prev))
        if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift()
      }
      return next
    })
    setSave('dirty')
  }, [])

  const updatePage = useCallback(
    (updater: (blocks: MenuBlock[]) => MenuBlock[]) => {
      if (!doc) return
      const target = doc.pages[Math.min(pageIdx, doc.pages.length - 1)]
      if (!target) return
      mutate({ pages: doc.pages.map((p) => (p.id === target.id ? { ...p, blocks: reindex(updater(p.blocks)) } : p)) })
    },
    [doc, pageIdx, mutate],
  )

  // ── автосохранение ────────────────────────────────────────────
  useEffect(() => {
    if (!doc) return
    const payload = JSON.stringify({ title, theme, doc: docSnapshot(doc) })
    if (payload === lastSaved.current) return
    setSave('dirty')
    const t = setTimeout(() => {
      setSave('saving')
      api<{ layout: ServerLayout; savedAt: number }>(`/menu-layouts/${numericId}`, {
        method: 'PUT',
        body: { title: title.trim() || 'Без названия', theme, doc: docSnapshot(doc) },
      })
        .then((res) => {
          lastSaved.current = payload
          setSave('saved')
          setSavedAt(res.savedAt)
          setDrift(res.layout.drift)
          setServerStats(res.layout.stats)
        })
        .catch((e: unknown) => {
          setSave('error')
          toast.push(e instanceof Error ? e.message : 'Не удалось сохранить макет', 'bad')
        })
    }, AUTOSAVE_MS)
    return () => clearTimeout(t)
  }, [doc, theme, title, numericId, toast])

  const undo = useCallback(() => {
    const prev = undoStack.current.pop()
    if (!prev) return
    setDoc(prev)
    setSave('dirty')
  }, [])

  // Delete скрывает блок в макете; товар каталога остаётся на месте.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /input|textarea|select/i.test(target.tagName)) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undo()
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault()
        updatePage((blocks) => toggleHidden(blocks, selectedId))
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selectedId, undo, updatePage])

  // ── действия ──────────────────────────────────────────────────
  const addProduct = (p: CatalogProduct) => {
    updatePage((blocks) => {
      // Позиция встаёт после последней позиции своей категории — как в каталоге, а не в конец листа.
      let at = blocks.length
      for (let i = blocks.length - 1; i >= 0; i--) {
        const b = blocks[i]!
        if (b.type === 'product' && b.categoryId === p.categoryId) {
          at = i + 1
          break
        }
      }
      const next = [...blocks]
      next.splice(at, 0, productBlock(p, at))
      return reindex(next)
    })
    setSave('dirty')
    toast.push(`«${p.name}» добавлен на лист`)
  }

  const addCategory = (categoryId: number, name: string) => {
    updatePage((blocks) => {
      const exists = blocks.some((b) => b.type === 'category' && b.categoryId === categoryId)
      if (exists) return blocks
      return reindex([...blocks, newBlock('category', blocks.length, { categoryId, titleOverride: name })])
    })
  }

  const addExtraBlock = (type: BlockType) => {
    updatePage((blocks) => reindex([...blocks, newBlock(type, blocks.length, type === 'note' ? { titleOverride: 'Хорошего дня!' } : {})]))
  }

  const seedFromCatalog = async () => {
    try {
      const res = await api<{ layout: ServerLayout; added: number }>(`/menu-layouts/${numericId}/seed-from-catalog`, {
        method: 'POST',
        body: { pageId: page?.id, replace: false },
      })
      hydrated.current = res.layout.id
      setDoc(docSnapshot(res.layout.doc))
      setDrift(res.layout.drift)
      setServerStats(res.layout.stats)
      lastSaved.current = JSON.stringify({ title: res.layout.title, theme: res.layout.theme, doc: docSnapshot(res.layout.doc) })
      toast.push(`Собрано из каталога: ${res.added} позиций`)
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось собрать из каталога', 'bad')
    }
  }

  const syncPrices = async () => {
    try {
      const res = await api<{ changed: unknown[]; layout: ServerLayout }>(`/menu-layouts/${numericId}/sync-prices`, { method: 'POST', body: {} })
      setDoc(docSnapshot(res.layout.doc))
      setDrift(res.layout.drift)
      lastSaved.current = JSON.stringify({ title: res.layout.title, theme: res.layout.theme, doc: docSnapshot(res.layout.doc) })
      toast.push(res.changed.length ? `Обновлено цен: ${res.changed.length}` : 'Цены уже совпадают с каталогом')
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось обновить цены', 'bad')
    }
  }

  const setFrozen = async (mode: 'live' | 'frozen') => {
    try {
      const res = await api<{ layout: ServerLayout }>(`/menu-layouts/${numericId}`, { method: 'PUT', body: { priceMode: mode } })
      setDoc(docSnapshot(res.layout.doc))
      setPriceMode(res.layout.priceMode)
      setFrozenAt(res.layout.frozenAt)
      setDrift(res.layout.drift)
      lastSaved.current = JSON.stringify({ title: res.layout.title, theme: res.layout.theme, doc: docSnapshot(res.layout.doc) })
      toast.push(mode === 'frozen' ? 'Цены зафиксированы — печать не изменится' : 'Цены снова живые, из каталога')
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось переключить режим цен', 'bad')
    }
  }

  const addPage = () => {
    if (!doc) return
    mutate({ pages: [...doc.pages, { id: `page-${Date.now().toString(36)}`, blocks: [] }] })
    setPageIdx(doc.pages.length)
  }

  const removePage = (idx: number) => {
    if (!doc || doc.pages.length <= 1) return
    mutate({ pages: doc.pages.filter((_, i) => i !== idx) })
    setPageIdx(Math.max(0, idx - 1))
  }

  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox message={error} onRetry={reload} />
  if (!doc || !previewPage || !page) return <Spinner />

  const format = data?.layout.format ?? 'a4_portrait'
  const filtered = products.filter((p) => {
    if (catFilter !== 'all' && p.categoryId !== catFilter) return false
    if (!search.trim()) return true
    return p.name.toLowerCase().includes(search.trim().toLowerCase())
  })

  const saveLabel =
    save === 'saving' ? 'Сохраняем…' : save === 'error' ? 'Не сохранено' : save === 'dirty' ? 'Есть изменения' : save === 'saved' ? 'Сохранено' : 'Сохранено'
  const driftText = driftBanner(drift.length ? drift : liveDrift, priceMode)

  const sheet = (opts: { interactive?: boolean; grid?: boolean; safe?: boolean } = {}) => (
    <MenuSheet
      page={previewPage}
      theme={theme}
      title={title}
      selectedId={opts.interactive ? selectedId : null}
      onSelect={opts.interactive ? setSelectedId : undefined}
      showGrid={opts.grid}
      showSafe={opts.safe}
      index={pageIdx + 1}
      total={doc.pages.length}
    />
  )

  const patchBlock = (patch: Partial<MenuBlock>) => {
    if (!selectedId) return
    updatePage((blocks) => blocks.map((b) => (b.id === selectedId ? { ...b, ...patch } : b)))
  }

  const catalogPane = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line px-3 py-2.5">
        <label className="flex min-h-9 items-center gap-2 rounded-lg border border-line bg-white px-2">
          <Search size={15} className="text-ink-tertiary" aria-hidden />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Найти товар"
            className="w-full bg-transparent text-[13px] outline-none"
          />
        </label>
        <div className="mt-2 flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setCatFilter('all')}
            className={cx('rounded-full border px-2.5 py-1 text-[11px] font-semibold', catFilter === 'all' ? 'border-brand bg-brand text-white' : 'border-line text-ink-secondary')}
          >
            Все
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCatFilter(c.id)}
              className={cx('rounded-full border px-2.5 py-1 text-[11px] font-semibold', catFilter === c.id ? 'border-brand bg-brand text-white' : 'border-line text-ink-secondary')}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {catalog.loading && !catalog.data && <Spinner label="Загрузка каталога…" />}
        {filtered.length === 0 && <p className="px-2 py-3 text-[13px] text-ink-secondary">Ничего не найдено.</p>}
        <ul className="space-y-1">
          {filtered.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => addProduct(p)}
                className="flex w-full items-center gap-2 rounded-lg border border-transparent px-1.5 py-1.5 text-left hover:border-line hover:bg-surface-2"
              >
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt="" className="h-9 w-9 flex-none rounded-md bg-surface-2 object-cover" />
                ) : (
                  <span className="grid h-9 w-9 flex-none place-items-center rounded-md bg-surface-2 text-ink-tertiary">
                    <ImageIcon size={14} aria-hidden />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ink">{p.name}</span>
                  <span className="block truncate text-[11px] text-ink-tertiary">
                    {p.price} ₽{p.variantLabel ? ` · ${p.variantLabel}` : ''}
                    {!p.available ? ' · скрыт в каталоге' : ''}
                  </span>
                </span>
                <Plus size={15} className="flex-none text-brand" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        {categories.length > 0 && (
          <div className="mt-3 rounded-lg border border-dashed border-line p-2">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Добавить заголовок категории</p>
            <div className="flex flex-wrap gap-1">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => addCategory(c.id, c.name)}
                  className="rounded-full border border-line px-2 py-1 text-[11px] text-ink-secondary hover:border-brand hover:text-brand"
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )

  const layersPane = (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      {page.blocks.length === 0 && <p className="p-2 text-[13px] text-ink-secondary">Лист пуст. Добавьте позиции из каталога.</p>}
      <ul className="space-y-0.5">
        {page.blocks.map((b, i) => (
          <li
            key={b.id}
            className={cx(
              'flex items-center gap-1 rounded-lg border px-1.5 py-1',
              selectedId === b.id ? 'border-brand bg-surface-2' : 'border-transparent hover:bg-surface-2',
              b.hidden && 'opacity-50',
            )}
          >
            <button type="button" onClick={() => setSelectedId(b.id)} className="min-w-0 flex-1 truncate text-left text-[12.5px]">
              <span className="text-ink-tertiary">{i + 1}.</span> {blockLabel(b)}
            </button>
            <button
              type="button"
              onClick={() => updatePage((blocks) => moveBlock(blocks, b.id, -1))}
              className="grid h-6 w-6 place-items-center rounded text-ink-tertiary hover:text-brand"
              aria-label="Выше"
            >
              <ArrowUp size={13} />
            </button>
            <button
              type="button"
              onClick={() => updatePage((blocks) => moveBlock(blocks, b.id, 1))}
              className="grid h-6 w-6 place-items-center rounded text-ink-tertiary hover:text-brand"
              aria-label="Ниже"
            >
              <ArrowDown size={13} />
            </button>
            <button
              type="button"
              onClick={() => updatePage((blocks) => toggleHidden(blocks, b.id))}
              className="grid h-6 w-6 place-items-center rounded text-ink-tertiary hover:text-brand"
              aria-label={b.hidden ? 'Показать' : 'Скрыть'}
            >
              {b.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )

  const designPane = (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <section className="border-b border-line px-3 py-3">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-[13px] font-semibold">Тема</h3>
          <span className="text-[11px] text-ink-tertiary">3 пресета</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {(Object.keys(THEME_PRESETS) as MenuTheme['preset'][]).map((p) => {
            const preset = THEME_PRESETS[p]
            const active = theme.preset === p
            return (
              <button
                key={p}
                type="button"
                onClick={() => setTheme({ ...theme, preset: p, bg: preset.bg, text: preset.text, accent: preset.accent })}
                aria-pressed={active}
                className={cx('rounded-lg border p-1 text-left', active ? 'border-brand ring-2 ring-brand/15' : 'border-line')}
              >
                <span className="flex h-11 flex-col justify-end gap-0.5 rounded p-1.5" style={{ background: preset.bg }}>
                  <i className="block h-[3px] w-3/5" style={{ background: preset.text }} />
                  <i className="block h-[2px] w-2/5" style={{ background: preset.text, opacity: 0.5 }} />
                  <i className="block h-[2px] w-1/5" style={{ background: preset.accent }} />
                </span>
                <span className="mt-1 block truncate text-[11px] text-ink-secondary">{preset.label}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="border-b border-line px-3 py-3">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-[13px] font-semibold">Шрифты</h3>
          <span className="text-[11px] text-ink-tertiary">2 семейства</span>
        </div>
        <Field label="Заголовки">
          <Select value={theme.fontHeading} onChange={(e) => setTheme({ ...theme, fontHeading: e.target.value as MenuTheme['fontHeading'] })}>
            <option value="Unbounded">Unbounded</option>
            <option value="Golos Text">Golos Text</option>
          </Select>
        </Field>
        <div className="mt-2">
          <Field label="Позиции и цены">
            <Select value={theme.fontBody} onChange={(e) => setTheme({ ...theme, fontBody: e.target.value as MenuTheme['fontBody'] })}>
              <option value="Golos Text">Golos Text</option>
              <option value="Unbounded">Unbounded</option>
            </Select>
          </Field>
        </div>
        <label className="mt-3 block text-[12px] text-ink-secondary">
          Кегль заголовка · {theme.headingSize}
          <input
            type="range"
            min={28}
            max={72}
            step={1}
            value={theme.headingSize}
            onChange={(e) => setTheme({ ...theme, headingSize: Number(e.target.value) })}
            className="mt-1 w-full"
          />
        </label>
        <label className="mt-2 block text-[12px] text-ink-secondary">
          Кегль позиций · {theme.itemSize}
          <input
            type="range"
            min={8}
            max={16}
            step={0.5}
            value={theme.itemSize}
            onChange={(e) => setTheme({ ...theme, itemSize: Number(e.target.value) })}
            className="mt-1 w-full"
          />
        </label>
      </section>

      <section className="border-b border-line px-3 py-3">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-[13px] font-semibold">Цвета</h3>
          <span className="text-[11px] text-ink-tertiary">brand-safe</span>
        </div>
        {(
          [
            ['bg', 'Фон'],
            ['text', 'Текст'],
            ['accent', 'Акцент'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 py-1 text-[12px] text-ink-secondary">
            <span className="flex-1">{label}</span>
            <code className="text-[11px] text-ink-tertiary">{theme[key].toUpperCase()}</code>
            <input
              type="color"
              value={theme[key]}
              onChange={(e) => setTheme({ ...theme, [key]: e.target.value.toUpperCase() })}
              className="h-6 w-6 rounded border border-line bg-transparent p-0"
              aria-label={label}
            />
          </label>
        ))}
      </section>

      <section className="border-b border-line px-3 py-3">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-[13px] font-semibold">Сетка</h3>
          <span className="text-[11px] text-ink-tertiary">лист</span>
        </div>
        <div className="flex gap-1" role="group" aria-label="Колонки">
          {([1, 2, 3] as const).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setTheme({ ...theme, columns: n })}
              aria-pressed={theme.columns === n}
              className={cx(
                'min-h-8 min-w-9 rounded-md border px-2 text-[12px] font-semibold',
                theme.columns === n ? 'border-brand bg-surface-2 text-brand' : 'border-line text-ink-secondary',
              )}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="mt-3">
          <Field label="Логотип">
            <Select value={theme.logoPosition} onChange={(e) => setTheme({ ...theme, logoPosition: e.target.value as MenuTheme['logoPosition'] })}>
              <option value="left">Сверху слева</option>
              <option value="top-right">Сверху справа</option>
              <option value="footer">Снизу в подвале</option>
            </Select>
          </Field>
        </div>
        <div className="mt-3">
          <span className="mb-1 block text-[12px] text-ink-secondary">Орнамент</span>
          <div className="flex gap-1">
            {(['line', 'beans', 'leaf', 'none'] as const).map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setTheme({ ...theme, ornament: o })}
                aria-pressed={theme.ornament === o}
                className={cx(
                  'grid h-8 min-w-9 place-items-center rounded-md border px-2 text-[12px]',
                  theme.ornament === o ? 'border-brand bg-surface-2 text-brand' : 'border-line text-ink-secondary',
                )}
                title={o === 'line' ? 'Линия' : o === 'beans' ? 'Зёрна' : o === 'leaf' ? 'Лист' : 'Без орнамента'}
              >
                {o === 'line' ? '—' : o === 'beans' ? '●●' : o === 'leaf' ? '◗' : '∅'}
              </button>
            ))}
          </div>
        </div>
        <label className="mt-3 block text-[12px] text-ink-secondary">
          Плотность
          <Select
            value={theme.density}
            onChange={(e) => setTheme({ ...theme, density: e.target.value as MenuTheme['density'] })}
            className="mt-1"
          >
            <option value="air">Воздушно</option>
            <option value="normal">Обычно</option>
            <option value="dense">Плотно</option>
          </Select>
        </label>
      </section>

      <section className="px-3 py-3">
        <h3 className="mb-2 text-[13px] font-semibold">Дополнительные блоки</h3>
        <div className="flex flex-wrap gap-1">
          {(
            [
              ['note', 'Заметка'],
              ['photo', 'Фото'],
              ['divider', 'Линия'],
              ['text', 'Текст'],
              ['qr', 'QR'],
            ] as [BlockType, string][]
          ).map(([t, label]) => (
            <button
              key={t}
              type="button"
              onClick={() => addExtraBlock(t)}
              className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-secondary hover:border-brand hover:text-brand"
            >
              + {label}
            </button>
          ))}
        </div>
      </section>
    </div>
  )

  const layerPane = selected ? (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex items-start gap-2 border-b border-line px-3 py-3">
        {selected.product?.imageUrl ? (
          <img src={selected.product.imageUrl} alt="" className="h-12 w-12 rounded-lg object-cover" />
        ) : (
          <span className="grid h-12 w-12 place-items-center rounded-lg bg-surface-2 text-ink-tertiary">
            <Type size={16} aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-ink-tertiary">{selected.type === 'product' ? 'Позиция' : 'Блок'}</p>
          <p className="truncate text-[13px] font-semibold text-ink">{blockLabel(selected)}</p>
          <p className="truncate text-[11px] text-ink-tertiary">
            {selected.productId ? `Каталог 6.7 · product_id ${selected.productId}` : 'Служебный блок макета'}
          </p>
        </div>
      </div>

      <section className="border-b border-line px-3 py-3">
        <h3 className="mb-2 text-[13px] font-semibold">Содержимое</h3>
        <Field label="Название в макете">
          <Input
            value={selected.titleOverride ?? ''}
            placeholder={selected.type === 'hero' ? 'Кофе и не только' : selected.type === 'header' ? 'весна / лето 2026' : 'Как в каталоге'}
            onChange={(e) => patchBlock({ titleOverride: e.target.value || null })}
          />
        </Field>
        {selected.type === 'product' && (
          <>
            <div className="mt-2">
              <Field label="Цена в макете" hint="Пусто — из каталога. Можно «169 / 269».">
                <Input
                  value={selected.priceText ?? ''}
                  placeholder={selected.product ? String(selected.product.priceRub ?? '') : '169 / 269'}
                  onChange={(e) => {
                    const v = e.target.value.trim()
                    const asNumber = /^\d+$/.test(v) ? Number(v) : null
                    patchBlock({ priceText: v || null, priceRubOverride: asNumber })
                  }}
                />
              </Field>
            </div>
            <div className="mt-2">
              <Field label="Бейдж">
                <Select value={selected.badge ?? ''} onChange={(e) => patchBlock({ badge: e.target.value || null })}>
                  <option value="">Без бейджа</option>
                  <option value="new">NEW</option>
                  <option value="hit">ХИТ</option>
                  <option value="vegan">VEGAN</option>
                </Select>
              </Field>
            </div>
            <label className="mt-3 flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={selected.showPhoto} onChange={(e) => patchBlock({ showPhoto: e.target.checked })} />
              Показывать фото
            </label>
          </>
        )}
        {selected.type !== 'product' && selected.type !== 'category' && (
          <div className="mt-2">
            <Field label="Текст">
              <Input value={selected.text ?? ''} onChange={(e) => patchBlock({ text: e.target.value || null })} />
            </Field>
          </div>
        )}
        <p className="mt-2 text-[11px] leading-4 text-ink-tertiary">
          Данные из каталога. Правки здесь меняют только макет — не кассу и не карточку товара.
        </p>
      </section>

      <section className="px-3 py-3">
        <h3 className="mb-2 text-[13px] font-semibold">Действия</h3>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon={<ArrowUp size={14} />} onClick={() => updatePage((b) => moveBlock(b, selected.id, -1))}>
            Выше
          </Button>
          <Button size="sm" variant="secondary" icon={<ArrowDown size={14} />} onClick={() => updatePage((b) => moveBlock(b, selected.id, 1))}>
            Ниже
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={selected.hidden ? <Eye size={14} /> : <EyeOff size={14} />}
            onClick={() => updatePage((b) => toggleHidden(b, selected.id))}
          >
            {selected.hidden ? 'Показать' : 'Скрыть'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={<Trash2 size={14} />}
            onClick={() => {
              updatePage((b) => b.filter((x) => x.id !== selected.id))
              setSelectedId(null)
            }}
          >
            Убрать с листа
          </Button>
        </div>
      </section>
    </div>
  ) : (
    <div className="p-3 text-[13px] text-ink-secondary">Выберите блок на листе или в списке слоёв.</div>
  )

  return (
    <>
      {/* ── тулбар ─────────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link
          to="/menu-layouts"
          className="inline-flex min-h-9 items-center gap-1 rounded-lg px-1.5 text-[13px] font-semibold text-brand hover:bg-surface-2"
        >
          <ArrowLeft size={16} /> Все макеты
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              aria-label="Название макета"
              className="min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-[19px] font-bold text-ink outline-none focus:underline"
            />
            <span
              className={cx(
                'inline-flex flex-none items-center gap-1 text-[11px] font-semibold',
                save === 'error' ? 'text-bad' : save === 'saved' || save === 'idle' ? 'text-ok' : 'text-ink-tertiary',
              )}
              aria-live="polite"
            >
              {save === 'saving' ? <Loader2 size={12} className="animate-spin" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
              {saveLabel}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[12px] text-ink-secondary">
            {formatLabel(format)} · {data?.layout.formatHint.mm} · {doc.pages.length} стр. ·{' '}
            {priceMode === 'frozen'
              ? `цены зафиксированы${fmtFrozen(frozenAt)}`
              : 'цены из каталога'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="secondary" icon={<Undo2 size={14} />} onClick={undo} disabled={undoStack.current.length === 0}>
            Отменить
          </Button>
          <Button size="sm" variant="secondary" icon={<Eye size={14} />} onClick={() => setPreviewOpen(true)}>
            Предпросмотр
          </Button>
          <Button size="sm" icon={<Download size={14} />} onClick={() => setExportOpen(true)}>
            Экспорт PDF
          </Button>
        </div>
      </div>

      {driftText && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-warn/40 bg-warn-soft px-3 py-2 text-[13px] text-warn">
          <RefreshCw size={15} className="flex-none" aria-hidden />
          <span className="min-w-0 flex-1">{driftText}</span>
          <Button size="sm" variant="secondary" onClick={() => void syncPrices()}>
            {priceMode === 'frozen' ? 'Проверить' : 'Обновить с каталога'}
          </Button>
        </div>
      )}

      {serverStats && serverStats.warnings > 0 && save !== 'dirty' && (
        <Banner tone="warn">
          Замечаний перед печатью: {serverStats.warnings}. {blockers.length ? 'Откройте слой с красной точкой и поправьте цену или фото.' : ''}
        </Banner>
      )}

      {/* ── мобильные вкладки ─────────────────────────────── */}
      <nav className="mb-3 flex gap-1 rounded-xl border border-line bg-surface-2 p-1 lg:hidden" aria-label="Разделы редактора">
        {(
          [
            ['preview', 'Превью', <Eye size={14} key="p" />],
            ['content', 'Состав', <ListTree size={14} key="c" />],
            ['design', 'Дизайн', <Palette size={14} key="d" />],
            ['export', 'PDF', <Download size={14} key="e" />],
          ] as [MobileTab, string, JSX.Element][]
        ).map(([key, label, icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setMobileTab(key)}
            aria-pressed={mobileTab === key}
            className={cx(
              'inline-flex min-h-9 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-lg px-2 text-[12.5px] font-semibold',
              mobileTab === key ? 'bg-white text-brand shadow-sm' : 'text-ink-secondary',
            )}
          >
            {icon}
            {label}
          </button>
        ))}
      </nav>

      {/* ── десктоп: три зоны ─────────────────────────────── */}
      <div className="hidden gap-3 lg:grid" style={{ gridTemplateColumns: 'minmax(220px, 260px) minmax(0, 1fr) minmax(240px, 290px)' }}>
        <aside className="flex max-h-[calc(100vh-210px)] min-h-[420px] flex-col overflow-hidden rounded-xl border border-line bg-white">
          <div className="flex border-b border-line">
            {(
              [
                ['catalog', 'Каталог'],
                ['layers', 'Слои'],
              ] as [LeftTab, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setLeftTab(k)}
                aria-pressed={leftTab === k}
                className={cx(
                  'min-h-10 flex-1 border-b-2 px-2 text-[13px] font-semibold',
                  leftTab === k ? 'border-brand text-brand' : 'border-transparent text-ink-secondary',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {leftTab === 'catalog' ? catalogPane : layersPane}
        </aside>

        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white px-2 py-1.5">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-secondary">
              <span className="rounded-md bg-surface-2 px-2 py-1">{data?.layout.formatHint.label} · {data?.layout.formatHint.mm}</span>
              <Badge tone={status === 'ready' ? 'ok' : 'neutral'}>{status === 'ready' ? 'Готов' : 'Черновик'}</Badge>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setShowGrid((v) => !v)}
                aria-pressed={showGrid}
                className={cx('grid h-8 w-8 place-items-center rounded-md', showGrid ? 'bg-surface-2 text-brand' : 'text-ink-tertiary hover:text-brand')}
                title="Сетка"
              >
                <Grid3x3 size={15} />
              </button>
              <button
                type="button"
                onClick={() => setShowSafe((v) => !v)}
                aria-pressed={showSafe}
                className={cx('h-8 rounded-md px-2 text-[11px] font-semibold', showSafe ? 'bg-surface-2 text-brand' : 'text-ink-tertiary hover:text-brand')}
                title="Безопасная зона"
              >
                поля
              </button>
              <span className="mx-1 h-5 w-px bg-line" />
              <button type="button" onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.1).toFixed(2)))} className="grid h-8 w-8 place-items-center rounded-md text-ink-tertiary hover:text-brand" aria-label="Уменьшить">
                <Minus size={15} />
              </button>
              <span className="w-10 text-center text-[11px] font-semibold tabular-nums text-ink-secondary">{Math.round(zoom * 100)}%</span>
              <button type="button" onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.1).toFixed(2)))} className="grid h-8 w-8 place-items-center rounded-md text-ink-tertiary hover:text-brand" aria-label="Увеличить">
                <Plus size={15} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto rounded-xl border border-line bg-[#e9ebef] p-4">
            <div
              className="mx-auto"
              style={{
                width: `${Math.round(560 * zoom)}px`,
                aspectRatio: String(LAYOUT_FORMATS.find((f) => f.id === format)?.ratio ?? 210 / 297),
              }}
            >
              <div className="h-full w-full shadow-[0_10px_30px_rgba(16,24,40,.15)]">{sheet({ interactive: true, grid: showGrid, safe: showSafe })}</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1 rounded-xl border border-line bg-white px-2 py-1.5">
            {doc.pages.map((p, i) => (
              <span key={p.id} className="inline-flex items-center">
                <button
                  type="button"
                  onClick={() => setPageIdx(i)}
                  aria-pressed={pageIdx === i}
                  className={cx(
                    'min-h-7 rounded-md border px-2 text-[12px] font-semibold',
                    pageIdx === i ? 'border-brand bg-surface-2 text-brand' : 'border-line text-ink-secondary',
                  )}
                >
                  {i + 1} <span className="text-[10px] text-ink-tertiary">{p.blocks.length}</span>
                </button>
                {doc.pages.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removePage(i)}
                    className="ml-0.5 grid h-6 w-6 place-items-center rounded text-ink-tertiary hover:text-bad"
                    aria-label={`Удалить страницу ${i + 1}`}
                  >
                    <X size={12} />
                  </button>
                )}
              </span>
            ))}
            <button
              type="button"
              onClick={addPage}
              className="grid h-7 w-7 place-items-center rounded-md border border-dashed border-line text-ink-tertiary hover:border-brand hover:text-brand"
              title="Добавить страницу"
              aria-label="Добавить страницу"
            >
              <Plus size={13} />
            </button>
            <span className="ml-auto text-[11px] text-ink-tertiary">
              {savedAt ? `сохранено ${ago(savedAt)}` : 'автосохранение'} · Delete скрывает блок
            </span>
          </div>
        </section>

        <aside className="flex max-h-[calc(100vh-210px)] min-h-[420px] flex-col overflow-hidden rounded-xl border border-line bg-white">
          <div className="flex border-b border-line">
            {(
              [
                ['design', 'Оформление'],
                ['layer', 'Слой'],
              ] as [RightTab, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setRightTab(k)}
                aria-pressed={rightTab === k}
                className={cx(
                  'min-h-10 flex-1 border-b-2 px-2 text-[13px] font-semibold',
                  rightTab === k ? 'border-brand text-brand' : 'border-transparent text-ink-secondary',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {rightTab === 'design' ? designPane : layerPane}
        </aside>
      </div>

      {/* ── мобильный режим ───────────────────────────────── */}
      <div className="lg:hidden">
        {mobileTab === 'preview' && (
          <div className="rounded-xl border border-line bg-[#e9ebef] p-3">
            <div className="mx-auto max-w-[360px] shadow-[0_10px_30px_rgba(16,24,40,.15)]">{sheet({ grid: showGrid, safe: showSafe })}</div>
            <div className="mt-2 flex items-center justify-center gap-2 text-[12px] text-ink-secondary">
              <button type="button" onClick={() => setPageIdx((i) => Math.max(0, i - 1))} disabled={pageIdx === 0} className="rounded-md border border-line px-2 py-1 disabled:opacity-40">
                ← стр.
              </button>
              <span className="tabular-nums">
                {pageIdx + 1} / {doc.pages.length}
              </span>
              <button
                type="button"
                onClick={() => setPageIdx((i) => Math.min(doc.pages.length - 1, i + 1))}
                disabled={pageIdx >= doc.pages.length - 1}
                className="rounded-md border border-line px-2 py-1 disabled:opacity-40"
              >
                стр. →
              </button>
            </div>
          </div>
        )}

        {mobileTab === 'content' && (
          <div className="overflow-hidden rounded-xl border border-line bg-white">
            <div className="flex border-b border-line">
              {(
                [
                  ['catalog', 'Каталог'],
                  ['layers', 'Содержание'],
                ] as [LeftTab, string][]
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setLeftTab(k)}
                  aria-pressed={leftTab === k}
                  className={cx('min-h-10 flex-1 border-b-2 text-[13px] font-semibold', leftTab === k ? 'border-brand text-brand' : 'border-transparent text-ink-secondary')}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="max-h-[60vh] overflow-y-auto">{leftTab === 'catalog' ? catalogPane : layersPane}</div>
          </div>
        )}

        {mobileTab === 'design' && <div className="overflow-hidden rounded-xl border border-line bg-white">{designPane}</div>}

        {mobileTab === 'export' && (
          <div className="rounded-xl border border-line bg-white p-3">
            <h2 className="text-[15px] font-semibold">PDF для типографии</h2>
            <p className="mt-1 text-[12px] text-ink-secondary">
              {doc.pages.length} стр. · {data?.layout.formatHint.label} · текст останется векторным.
            </p>
            <ul className="mt-3 space-y-1.5 text-[12.5px]">
              <li className="flex items-start gap-2">
                <Check size={14} className="mt-0.5 flex-none text-ok" aria-hidden /> <span>Текст — вектор, не картинка страницы</span>
              </li>
              <li className="flex items-start gap-2">
                <Check size={14} className="mt-0.5 flex-none text-ok" aria-hidden /> <span>Орнаменты векторные, поля под обрез 3 мм</span>
              </li>
              {blockers.length > 0 && (
                <li className="flex items-start gap-2 text-bad">
                  <X size={14} className="mt-0.5 flex-none" aria-hidden /> <span>{blockers.length} замечани(й): {blockers.slice(0, 2).map((b) => b.text).join(', ')}</span>
                </li>
              )}
            </ul>
            <Button className="mt-3 w-full" icon={<Download size={15} />} onClick={() => setExportOpen(true)}>
              Настроить PDF
            </Button>
            <p className="mt-2 text-[11px] text-ink-tertiary">Печатный PDF: 300 dpi, поля 3 мм. Экранный: RGB, без полей.</p>
          </div>
        )}
      </div>

      {/* ── предпросмотр ──────────────────────────────────── */}
      {previewOpen && (
        <div className="fixed inset-0 z-[70] overflow-y-auto bg-black/70 p-4" onMouseDown={(e) => e.target === e.currentTarget && setPreviewOpen(false)}>
          <div className="mx-auto max-w-[720px]">
            <div className="mb-2 flex items-center justify-between text-white">
              <span className="text-[13px] font-semibold">
                {title} · {pageIdx + 1} / {doc.pages.length}
              </span>
              <button type="button" onClick={() => setPreviewOpen(false)} className="grid h-9 w-9 place-items-center rounded-full bg-white/15" aria-label="Закрыть">
                <X size={18} />
              </button>
            </div>
            <div className="shadow-2xl">
              <MenuSheet page={previewPage} theme={theme} title={title} index={pageIdx + 1} total={doc.pages.length} />
            </div>
            <div className="mt-3 flex justify-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => setPageIdx((i) => Math.max(0, i - 1))} disabled={pageIdx === 0}>
                ←
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setPageIdx((i) => Math.min(doc.pages.length - 1, i + 1))} disabled={pageIdx >= doc.pages.length - 1}>
                →
              </Button>
              <Button size="sm" icon={<Download size={14} />} onClick={() => { setPreviewOpen(false); setExportOpen(true) }}>
                Экспорт PDF
              </Button>
            </div>
          </div>
        </div>
      )}

      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        layoutId={numericId}
        format={format}
        pages={doc.pages.length}
        blockers={blockers.length ? blockers : data?.layout.blockers ?? []}
        onGoToBlock={(blockId) => {
          setExportOpen(false)
          setSelectedId(blockId)
          setRightTab('layer')
          setMobileTab('content')
          const blocks = doc.pages[pageIdx]?.blocks ?? []
          if (!blocks.some((b) => b.id === blockId)) {
            const idx = doc.pages.findIndex((p) => p.blocks.some((b) => b.id === blockId))
            if (idx >= 0) setPageIdx(idx)
          }
        }}
      />

      <ConfirmDialog open={deleteOpen} title="Удалить макет?" confirmLabel="Удалить" danger onCancel={() => setDeleteOpen(false)} onConfirm={() => setDeleteOpen(false)}>
        Черновик подтверждения.
      </ConfirmDialog>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-[12px] text-ink-secondary">
        <button type="button" onClick={() => setStatus((s) => (s === 'ready' ? 'draft' : 'ready'))} className="text-brand hover:underline">
          {status === 'ready' ? 'Вернуть в черновик' : 'Отметить готовым к печати'}
        </button>
        <span className="text-ink-tertiary">·</span>
        <button type="button" onClick={() => void seedFromCatalog()} className="text-brand hover:underline">
          Собрать из каталога
        </button>
        <span className="text-ink-tertiary">·</span>
        <button type="button" onClick={() => void setFrozen(priceMode === 'frozen' ? 'live' : 'frozen')} className="text-brand hover:underline">
          {priceMode === 'frozen' ? 'Вернуть живые цены' : 'Зафиксировать цены'}
        </button>
        <span className="text-ink-tertiary">·</span>
        <button type="button" onClick={() => setFormatOpen(true)} className="text-brand hover:underline">
          Сменить формат
        </button>
      </div>

      <Drawer open={formatOpen} onClose={() => setFormatOpen(false)} title="Формат листа">
        <div className="space-y-2">
          {LAYOUT_FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={async () => {
                setFormatOpen(false)
                try {
                  await api(`/menu-layouts/${numericId}`, { method: 'PUT', body: { format: f.id } })
                  toast.push(`Формат: ${f.label}`)
                  reload()
                } catch (e) {
                  toast.push(e instanceof Error ? e.message : 'Не удалось сменить формат', 'bad')
                }
              }}
              className={cx('flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left', format === f.id ? 'border-brand bg-surface-2' : 'border-line')}
            >
              <span className="text-[13px] font-semibold">{f.label}</span>
              <span className="text-[11px] text-ink-tertiary">{f.mm} мм</span>
            </button>
          ))}
        </div>
      </Drawer>

    </>
  )
}

/* ───────────── экспорт PDF ───────────── */

type ExportProps = {
  open: boolean
  onClose: () => void
  layoutId: number
  format: LayoutFormat
  pages: number
  blockers: { blockId: string; code: string; text: string }[]
  onGoToBlock: (blockId: string) => void
}

function ExportModal({ open, onClose, layoutId, format, pages, blockers, onGoToBlock }: ExportProps) {
  const [preset, setPreset] = useState<'print' | 'screen'>('print')
  const [bleed, setBleed] = useState(3)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [forced, setForced] = useState(false)

  useEffect(() => {
    if (!open) return
    setErr('')
    setForced(false)
  }, [open])

  if (!open) return null

  const download = async (force: boolean) => {
    setBusy(true)
    setErr('')
    try {
      const qs = new URLSearchParams({ preset, bleed: String(preset === 'print' ? bleed : 0) })
      if (force) qs.set('force', '1')
      const res = await fetch(`/api/admin/menu-layouts/${layoutId}/export.pdf?${qs.toString()}`, {
        headers: { 'X-Admin-Token': tokenStore.get() },
      })
      if (res.status === 409) {
        setForced(true)
        setErr('В макете есть незаполненные позиции. Можно скачать как есть — но лучше поправить.')
        return
      }
      if (!res.ok) throw new Error(`Сервер ответил ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `menu-${layoutId}-${new Date().toISOString().slice(0, 10)}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось скачать PDF')
    } finally {
      setBusy(false)
    }
  }

  const hard = blockers.filter((b) => b.code !== 'notice')

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Экспорт PDF" className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-soft">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-ink-tertiary">Печать и экран</p>
            <h2 className="text-lg font-bold">Экспорт PDF</h2>
            <p className="mt-0.5 text-[13px] text-ink-secondary">Соберите файл для типографии или отправьте гостю.</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full hover:bg-surface-2" aria-label="Закрыть">
            <X size={18} />
          </button>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <div className="flex gap-1 rounded-lg bg-surface-2 p-1">
              {(
                [
                  ['print', 'Для печати'],
                  ['screen', 'Для экрана'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setPreset(k)}
                  aria-pressed={preset === k}
                  className={cx('min-h-8 flex-1 rounded-md text-[12.5px] font-semibold', preset === k ? 'bg-white text-brand shadow-sm' : 'text-ink-secondary')}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-3 space-y-2">
              <Field label="Формат">
                <Input value={`${formatLabel(format)} · ${LAYOUT_FORMATS.find((f) => f.id === format)?.mm ?? ''} мм`} readOnly />
              </Field>
              <Field label="Поля под обрез">
                <Select value={String(bleed)} onChange={(e) => setBleed(Number(e.target.value))} disabled={preset === 'screen'}>
                  <option value="3">3 мм (рекомендуется)</option>
                  <option value="0">0 мм</option>
                  <option value="5">5 мм</option>
                </Select>
              </Field>
            </div>
          </div>

          <div className="rounded-xl border border-line p-3">
            <p className="mb-2 text-[12px] font-semibold text-ink-secondary">Что будет в файле</p>
            <ul className="space-y-1.5 text-[12.5px]">
              <li className="flex items-start gap-2">
                <Check size={14} className="mt-0.5 flex-none text-ok" aria-hidden /> Текст — вектор (можно редактировать в типографии)
              </li>
              <li className="flex items-start gap-2">
                <Check size={14} className="mt-0.5 flex-none text-ok" aria-hidden /> Шрифты Golos Text и Unbounded встроены
              </li>
              <li className="flex items-start gap-2">
                <Check size={14} className="mt-0.5 flex-none text-ok" aria-hidden /> {pages} стр. · метки реза при полях
              </li>
              {hard.length > 0 && (
                <li className="flex items-start gap-2 text-bad">
                  <X size={14} className="mt-0.5 flex-none" aria-hidden /> {hard.length} позиц. без цены/удалены из каталога
                </li>
              )}
            </ul>
            {hard.length > 0 && (
              <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto text-[12px]">
                {hard.map((b) => (
                  <li key={`${b.blockId}-${b.text}`}>
                    <button type="button" onClick={() => onGoToBlock(b.blockId)} className="text-left text-brand hover:underline">
                      {b.text} → открыть блок
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {err && <p className="mt-3 rounded-lg bg-bad-soft px-3 py-2 text-[12.5px] text-bad">{err}</p>}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-ink-tertiary">PDF векторный: текст не растрируется.</span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Отмена
            </Button>
            {forced ? (
              <Button icon={<Download size={15} />} loading={busy} onClick={() => void download(true)}>
                Всё равно скачать
              </Button>
            ) : (
              <Button icon={<Download size={15} />} loading={busy} onClick={() => void download(false)}>
                Скачать PDF
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

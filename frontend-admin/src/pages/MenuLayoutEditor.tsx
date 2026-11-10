import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical,
  AlignStartHorizontal, AlignStartVertical, ArrowDown, ArrowLeft, ArrowUp, Check, Download,
  ChevronDown, ChevronRight, Eye, EyeOff, Grid3x3, GripVertical, History, ImagePlus, Layers, ListTree, Loader2, Lock, LockOpen, Maximize2,
  Minus, Palette, Plus, Redo2, RefreshCw, Search, Sparkles, Trash2, Type, Undo2, Upload, X,
} from 'lucide-react'
import { ApiError, api, tokenStore, uploadFile, uploadMenuFont } from '../api/client'
import { canRedo, canUndo, emptyHistory, pushHistory, redoStep, undoStep, type DocHistory } from '../lib/docHistory'
import { useApi } from '../api/useApi'
import { ago } from '../lib/format'
import {
  DEFAULT_RECT,
  DEFAULT_THEME,
  FONT_FAMILIES,
  FONT_LABELS,
  LAYOUT_FORMATS,
  MIN_H,
  MIN_W,
  BRAND_COLORS,
  THEME_PRESETS,
  blockLabel,
  bringToFront,
  byZ,
  clampRect,
  addItemToSection,
  collapseDuplicateProducts,
  docPayload,
  docSnapshot,
  driftBanner,
  docSections,
  findItemByProduct,
  duplicateProducts,
  effectiveType,
  itemCount,
  moveItem,
  removeItem,
  renameSection,
  toggleItemHidden,
  formatFull,
  formatLabel,
  formatSize,
  isUploadsUrl,
  localDrift,
  moveRect,
  newBlock,
  nextFreeRect,
  productBlock,
  resizeRect,
  snapRect,
  resolvePreview,
  sendToBack,
  toggleHidden,
  topZ,
  type BlockType,
  type CatalogProduct,
  type LayoutFormat,
  type MenuBlock,
  type MenuDoc,
  type MenuTheme,
  type Rect,
  type ResizeHandle,
} from '../lib/menuLayout'
import { Badge, Button, Banner, Drawer, cx, ErrorBox, Field, Input, Select, Spinner, useToast } from '../ui/kit'
import MenuCanvas from '../components/menuLayout/MenuCanvas'
import ColorField from '../components/menuLayout/ColorField'
import {
  alignBlocks, clampZoom, distributeBlocks, domTextMeasurer, editorMode, effectiveDpi, fitFontSize, fitZoom, groupBlocks,
  groupKeyOf, groupSelectionIds, layoutColumns, rectsIntersect, reorderBlocks, sheetWidthMm, snapToGrid,
  snapWithGuides, ungroupBlocks, zoomStep,
  type AlignMode, type SnapGuides,
} from '../lib/menuTools'
import {
  bindBlocks, blockStyle, detachBlocks, mergeStylePatch, removeStyle, styleFromBlock, stylePropsOf,
  styleUsage, touchesStyle, updateStyle,
} from '../lib/blockStyles'
import { typograph } from '../lib/typography'
import { MENU_LAYOUT_V2 } from '../lib/featureFlags'
import { mmToPct, pctToMm, safeBoxOffset, safeBoxSize, sheetMm } from '../lib/sheetGeometry'
import { perfDragEnd, perfDragStart, perfFrame, perfInit, perfPdf, perfTTI } from '../lib/perf'

type SaveBody = { title: string; theme: MenuTheme; doc: MenuDoc }

type Blocker = { blockId: string; code: string; text: string; label: string; pageIdx: number }

type ServerLayout = {
  id: number
  title: string
  format: LayoutFormat
  status: 'draft' | 'ready'
  theme: MenuTheme
  priceMode: 'live' | 'frozen'
  frozenAt: number | null
  updatedAt: number
  rev: number
  sections: number
  schemaVersion: number
  stats: { pages: number; products: number; warnings: number }
  drift: { blockId: string; title: string; from: number | null; to: number | null }[]
  blockers: { blockId: string; code: string; text: string }[]
  doc: MenuDoc
  formatHint: { label: string; mm: string }
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
type MobileTab = 'preview' | 'content' | 'design' | 'export'
type LeftTab = 'catalog' | 'places' | 'layers'
type RightTab = 'design' | 'block'

const AUTOSAVE_MS = 800

const fmtFrozen = (ms: number | null): string =>
  ms ? ` с ${new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}` : ''

/**
 * Редактор макета: холст с независимыми блоками.
 * Каждый блок двигается и растягивается сам по себе — никакой общей «потоковой» сетки.
 */
export default function MenuLayoutEditor() {
  const { id } = useParams()
  const toast = useToast()
  const numericId = Number(id)

  const { data, error, loading, reload } = useApi<{ layout: ServerLayout }>(
    Number.isFinite(numericId) ? `/menu-layouts/${numericId}` : null,
  )
  // Лёгкий каталог макета: сразу с объёмами и ценами, без N+1 по /products.
  const catalog = useApi<{ products: CatalogProduct[]; categories: { id: number; name: string }[] }>('/menu-layouts/catalog')
  const templatesData = useApi<{ templates: { id: string; name: string }[] }>('/menu-layouts/templates')

  const [doc, setDoc] = useState<MenuDoc | null>(null)
  const [theme, setTheme] = useState<MenuTheme>(DEFAULT_THEME)
  const [title, setTitle] = useState('')
  const [status, setStatus] = useState<'draft' | 'ready'>('draft')
  const [priceMode, setPriceMode] = useState<'live' | 'frozen'>('live')
  const [frozenAt, setFrozenAt] = useState<number | null>(null)
  const [save, setSave] = useState<SaveState>('idle')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [drift, setDrift] = useState<ServerLayout['drift']>([])

  const [pageIdx, setPageIdx] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** Мультивыбор: Shift+клик и рамка. Основной блок остаётся в `selectedId`. */
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [guides, setGuides] = useState<SnapGuides>({ x: [], y: [] })
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  /** Единицы координат в свойствах блока: проценты или миллиметры. */
  const [unit, setUnit] = useState<'pct' | 'mm'>('pct')
  /** Командная палитра ⌘K. */
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [paletteIndex, setPaletteIndex] = useState(0)
  /** Онбординг «3 шага»: скрывается после «Понятно». */
  const [onboardingHidden, setOnboardingHidden] = useState(() => {
    try {
      return localStorage.getItem('menu-layout-onboarding') === 'done'
    } catch {
      return false
    }
  })
  const [layerQuery, setLayerQuery] = useState('')
  /** Перетаскивание слоя: какой блок сейчас тащат. */
  const [layerDragId, setLayerDragId] = useState<string | null>(null)
  /** Свои шрифты аккаунта: файлы в uploads, семейство в теме. */
  const [ownFonts, setOwnFonts] = useState<{ id: number; family: string; url: string; boldUrl: string | null }[]>([])
  const [fontBusy, setFontBusy] = useState(false)
  /** Палитры бренда на аккаунт: общие для всех макетов. */
  const [palettes, setPalettes] = useState<{ id: number; name: string; colors: string[] }[]>([])
  /** История версий макета: снимки документа и темы. */
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [versions, setVersions] = useState<
    { id: number; rev: number; title: string; note: string | null; createdAt: number; pages: number; blocks: number }[]
  >([])
  const [versionNote, setVersionNote] = useState('')
  const [paletteName, setPaletteName] = useState('')
  /** Имя нового мастер-стиля блока (P2-2). */
  const [newStyleName, setNewStyleName] = useState('')
  /** Черновик из localStorage, если прошлая сессия оборвалась. */
  const [draftOffer, setDraftOffer] = useState<{ body: SaveBody; savedAt: number } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  /** Свёрнутые группы в списке слоёв. */
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([])
  const clipboard = useRef<MenuBlock | null>(null)
  const canvasBox = useRef<HTMLDivElement | null>(null)
  /** Пробел включает панорамирование листа, как в графических редакторах. */
  const [spaceDown, setSpaceDown] = useState(false)
  const [leftTab, setLeftTab] = useState<LeftTab>('catalog')
  const [rightTab, setRightTab] = useState<RightTab>('design')
  const [mobileTab, setMobileTab] = useState<MobileTab>('preview')
  /**
   * Раскладка зависит от ширины самого редактора, а не окна: в админке слева
   * рейл 244 px, поэтому на iPad 1024 редактору достаётся ~730 px и брейкпоинт
   * `lg` его ошибочно отправлял в мобильный режим.
   */
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [mode, setMode] = useState<'narrow' | 'medium' | 'wide'>('wide')
  /** На средней ширине левая панель уезжает в шторку, чтобы лист не сжимался. */
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [showAllProducts, setShowAllProducts] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiPlan, setAiPlan] = useState<{ summary: string; ops: unknown[] } | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [catFilter, setCatFilter] = useState<number | 'all'>('all')
  const [zoom, setZoom] = useState(1)
  const [showGrid, setShowGrid] = useState(false)
  /** Шаг сетки в процентах и число колонок — для визуальных направляющих и прилипания. */
  const [gridStep, setGridStep] = useState(5)
  const [gridCols, setGridCols] = useState(1)
  const [showSafe, setShowSafe] = useState(true)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [formatOpen, setFormatOpen] = useState(false)
  const [busyUpload, setBusyUpload] = useState(false)

  const [history, setHistory] = useState<DocHistory>(emptyHistory)
  /** Версия документа, которую видит это окно. Расхождение с сервером = конфликт. */
  const revRef = useRef(1)
  const [conflict, setConflict] = useState<{ rev: number } | null>(null)
  const hydrated = useRef<number | null>(null)
  const lastSaved = useRef('')
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{
    id: string
    mode: 'move' | 'resize'
    handle: ResizeHandle
    startX: number
    startY: number
    /** Рамки всех двигаемых блоков: мультивыбор тянется целиком. */
    rects: { id: string; rect: Rect; locked: boolean }[]
    w: number
    h: number
    /** Снимок «до жеста» уже в истории — дальше кадры жеста её не трогают. */
    pushed: boolean
  } | null>(null)

  useEffect(() => {
    perfInit()
  }, [])

  const loadFonts = useCallback(async () => {
    try {
      const res = await api<{ fonts: { id: number; family: string; url: string; boldUrl: string | null }[] }>('/menu-fonts')
      setOwnFonts(res.fonts ?? [])
    } catch (e) {
      // Шрифты — удобство: без них работает каталог встроенных, но ошибку видно в консоли.
      console.warn('[menu-fonts] не удалось загрузить список', e)
    }
  }, [])

  useEffect(() => {
    void loadFonts()
  }, [loadFonts])

  // @font-face для загруженных шрифтов: тот же файл использует PDF на сервере.
  useEffect(() => {
    const id = 'menu-own-fonts'
    let el = document.getElementById(id) as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = id
      document.head.appendChild(el)
    }
    el.textContent = ownFonts
      .map(
        (f) => `@font-face{font-family:"${f.family}";font-style:normal;font-weight:400;font-display:swap;src:url("${f.url}");}
@font-face{font-family:"${f.family}";font-style:normal;font-weight:700;font-display:swap;src:url("${f.boldUrl ?? f.url}");}`,
      )
      .join('\n')
  }, [ownFonts])

  const uploadFont = async (file: File, bold: File | null) => {
    setFontBusy(true)
    try {
      const font = await uploadMenuFont(file, bold)
      await loadFonts()
      setTheme((t) => ({ ...t, fontHeading: font.family }))
      toast.push(`Шрифт «${font.family}» загружен и выбран для заголовков`)
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось загрузить шрифт', 'bad')
    } finally {
      setFontBusy(false)
    }
  }

  const removeFont = async (id: number) => {
    try {
      await api(`/menu-fonts/${id}`, { method: 'DELETE' })
      await loadFonts()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось удалить шрифт', 'bad')
    }
  }

  const loadPalettes = useCallback(async () => {
    try {
      const res = await api<{ palettes: { id: number; name: string; colors: string[] }[] }>('/menu-palettes')
      setPalettes(res.palettes)
    } catch {
      /* палитры — удобство: без них редактор работает */
    }
  }, [])

  useEffect(() => {
    void loadPalettes()
  }, [loadPalettes])

  const savePalette = async () => {
    const name = paletteName.trim() || `Палитра ${palettes.length + 1}`
    try {
      await api('/menu-palettes', {
        method: 'POST',
        body: { name, colors: [theme.bg, theme.text, theme.accent] },
      })
      setPaletteName('')
      await loadPalettes()
      toast.push(`Палитра «${name}» сохранена`)
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось сохранить палитру', 'bad')
    }
  }

  const applyPalette = (colors: string[]) => {
    const [bg, text, accent] = colors
    setTheme((t) => ({ ...t, bg: bg ?? t.bg, text: text ?? t.text, accent: accent ?? t.accent }))
    toast.push('Палитра применена к листу')
  }

  const loadVersions = useCallback(async () => {
    if (!Number.isFinite(numericId)) return
    try {
      const res = await api<{ versions: typeof versions }>(`/menu-layouts/${numericId}/versions`)
      setVersions(res.versions)
    } catch {
      /* история — удобство, без неё редактор работает */
    }
  }, [numericId])

  useEffect(() => {
    if (versionsOpen) void loadVersions()
  }, [versionsOpen, loadVersions])

  const saveVersion = async () => {
    try {
      await flush()
      await api(`/menu-layouts/${numericId}/versions`, {
        method: 'POST',
        body: { note: versionNote.trim() || undefined },
      })
      setVersionNote('')
      await loadVersions()
      toast.push('Версия сохранена')
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось сохранить версию', 'bad')
    }
  }

  const restoreVersion = async (vid: number) => {
    try {
      await api(`/menu-layouts/${numericId}/versions/${vid}/restore`, { method: 'POST', body: {} })
      hydrated.current = null
      setVersionsOpen(false)
      await reload()
      toast.push('Макет восстановлен из версии')
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось восстановить версию', 'bad')
    }
  }

  const removeVersion = async (vid: number) => {
    try {
      await api(`/menu-layouts/${numericId}/versions/${vid}`, { method: 'DELETE' })
      await loadVersions()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось удалить версию', 'bad')
    }
  }

  const removePalette = async (id: number) => {
    try {
      await api(`/menu-palettes/${id}`, { method: 'DELETE' })
      await loadPalettes()
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось удалить палитру', 'bad')
    }
  }

  useEffect(() => {
    const isField = (el: EventTarget | null) => el instanceof HTMLElement && /input|textarea|select/i.test(el.tagName)
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isField(e.target)) {
        e.preventDefault()
        setSpaceDown(true)
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  useEffect(() => {
    if (doc) perfTTI()
  }, [doc])

  useEffect(() => {
    const layout = data?.layout
    if (!layout || hydrated.current === layout.id) return
    hydrated.current = layout.id
    setDoc(docSnapshot(layout.doc))
    setHistory(emptyHistory())
    revRef.current = layout.rev
    setConflict(null)
    setTheme({ ...DEFAULT_THEME, ...layout.theme })
    setTitle(layout.title)
    setStatus(layout.status)
    setSavedAt(layout.updatedAt)
    setPriceMode(layout.priceMode)
    setFrozenAt(layout.frozenAt)
    setDrift(layout.drift)
    lastSaved.current = JSON.stringify({ title: layout.title, theme: layout.theme, doc: docSnapshot(layout.doc) })
    setSave('idle')

    // Черновик прошлой сессии: предлагаем, только если он новее серверного и отличается.
    try {
      const raw = localStorage.getItem(`menu-layout-draft-${layout.id}`)
      if (raw) {
        const parsed = JSON.parse(raw) as { body: SaveBody; savedAt: number }
        const server = JSON.stringify({ title: layout.title, theme: layout.theme, doc: docSnapshot(layout.doc) })
        const local = JSON.stringify(parsed.body)
        if (parsed.savedAt > layout.updatedAt && local !== server) setDraftOffer(parsed)
        else localStorage.removeItem(`menu-layout-draft-${layout.id}`)
      }
    } catch {
      /* битый черновик не должен мешать открыть макет */
    }
  }, [data])

  const products = catalog.data?.products ?? []
  const categories = catalog.data?.categories ?? []
  const catalogName = (productId: number | null) =>
    products.find((p) => p.id === productId)?.name ?? (productId ? `Товар #${productId}` : 'Без товара')

  /** Имя для слоёв и свойств: товар из каталога, если в документе нет резолва. */
  const layerName = (b: MenuBlock) =>
    b.displayName ?? (b.type === 'product' ? catalogName(b.productId) : null) ?? blockLabel(b)

  const page = doc?.pages[Math.min(pageIdx, (doc?.pages.length ?? 1) - 1)] ?? null
  const previewDoc = useMemo(() => (doc ? resolvePreview(doc, products, priceMode) : null), [doc, products, priceMode])
  const previewPage = previewDoc?.pages[Math.min(pageIdx, (previewDoc.pages.length || 1) - 1)] ?? null
  const selected = page?.blocks.find((b) => b.id === selectedId) ?? null
  const liveDrift = useMemo(() => (doc ? localDrift(doc, products) : []), [doc, products])

  const blockers = useMemo(() => {
    if (!previewDoc) return [] as Blocker[]
    const out: Blocker[] = []
    previewDoc.pages.forEach((p, pageIdx) => {
      for (const b of p.blocks) {
        for (const w of b.warnings ?? []) {
          out.push({
            blockId: b.id,
            pageIdx,
            label: blockLabel(b),
            code: w === 'нет цены' ? 'no_price' : w === 'позиции больше нет в каталоге' ? 'missing_product' : 'notice',
            text: w,
          })
        }
      }
    })
    return out
  }, [previewDoc])

  /** Показать блок из замечания: нужная страница + выделение. */
  const goToBlock = (blockId: string, page?: number) => {
    if (typeof page === 'number') setPageIdx(page)
    setSelectedId(blockId)
    setRightTab('block')
    setMobileTab((tab) => (tab === 'content' ? 'content' : 'preview'))
  }

  const mutate = useCallback(
    (next: MenuDoc, opts: { history?: boolean } = {}) => {
      // Один шаг истории на осмысленное действие; кадры перетаскивания идут без него.
      if (opts.history !== false && doc) setHistory((h) => pushHistory(h, doc))
      setDoc(next)
      setSave('dirty')
    },
    [doc],
  )

  const updatePage = useCallback(
    (updater: (blocks: MenuBlock[]) => MenuBlock[], opts: { history?: boolean } = {}) => {
      if (!doc) return
      const target = doc.pages[Math.min(pageIdx, doc.pages.length - 1)]
      if (!target) return
      // `...doc` обязателен: иначе правка блоков стирала бы стили и прочие поля документа.
      mutate({ ...doc, pages: doc.pages.map((p) => (p.id === target.id ? { ...p, blocks: updater(p.blocks) } : p)) }, opts)
    },
    [doc, pageIdx, mutate],
  )

  const patchBlock = useCallback(
    (patch: Partial<MenuBlock>, id: string | null = selectedId) => {
      if (!id) return
      const block = doc?.pages.flatMap((p) => p.blocks).find((b) => b.id === id)
      const style = doc ? blockStyle(doc, block) : null
      // Мастер-стиль: правка кегля/жирности/выравнивания у привязанного блока меняет
      // стиль и все блоки, которые за ним следуют, — иначе стиль был бы просто ярлыком.
      if (doc && style && touchesStyle(patch)) {
        mutate(updateStyle(doc, style.id, mergeStylePatch(patch)))
        return
      }
      updatePage((blocks) => blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)))
    },
    [doc, selectedId, updatePage, mutate],
  )

  // Удаление блока с листа (не товара каталога). Возврат — ⌘Z.
  const deleteBlock = useCallback(
    (id: string) => {
      const block = doc?.pages.flatMap((p) => p.blocks).find((b) => b.id === id)
      if (!block) return
      updatePage((bs) => bs.filter((x) => x.id !== id))
      setSelectedId((cur) => (cur === id ? null : cur))
      toast.push(`«${blockLabel(block)}» убран с листа — ⌘Z вернёт`)
    },
    [doc, updatePage, toast],
  )

  /** Выделение: обычный клик — один блок, Shift+клик — добавить/убрать из выделения. */
  const selectBlock = useCallback(
    (id: string, e?: ReactPointerEvent<HTMLDivElement>) => {
      setCtxMenu(null)
      if (e && (e.shiftKey || e.metaKey || e.ctrlKey)) {
        setSelectedIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
        setSelectedId(id)
        return
      }
      // Группа выделяется целиком: клик по одному блоку берёт все его блоки.
      setSelectedIds(groupSelectionIds(page?.blocks ?? [], id))
      setSelectedId(id)
      // Выбрал блок — сразу показываем его свойства, а не общее оформление.
      setRightTab('block')
    },
    [page],
  )

  /** Двигать/выравнивать — только незаблокированные блоки. */
  const editableIds = useMemo(
    () => (page?.blocks ?? []).filter((b) => selectedIds.includes(b.id) && !b.locked).map((b) => b.id),
    [page, selectedIds],
  )

  /** Цвет применяется сразу и попадает в «недавние», если это не цвет бренда. */
  const applyThemeColor = (key: 'bg' | 'text' | 'accent', next: string) => {
    const known = (BRAND_COLORS as readonly string[]).includes(next.toUpperCase())
    const recent = known ? theme.recentColors ?? [] : [next, ...(theme.recentColors ?? []).filter((c) => c !== next)].slice(0, 8)
    setTheme({ ...theme, [key]: next, recentColors: recent })
  }

  const align = (mode: AlignMode) => {
    if (!page) return
    updatePage((blocks) => alignBlocks(blocks, editableIds, mode))
  }
  const distribute = (axis: 'x' | 'y') => {
    if (!page) return
    updatePage((blocks) => distributeBlocks(blocks, editableIds, axis))
  }

  /** Сгруппировать выделение: дальше блоки ходят вместе и выделяются одним кликом. */
  /** Разложить выделение по колонкам: порядок — как читают. */
  const columns = (n: 1 | 2 | 3) => {
    if (!page || editableIds.length < 2) return
    updatePage((blocks) => layoutColumns(blocks, editableIds, n))
    toast.push(`Разложено в ${n === 1 ? 'одну колонку' : `${n} колонки`}`)
  }

  const groupSelection = () => {
    if (!page || editableIds.length < 2) return
    updatePage((blocks) => groupBlocks(blocks, editableIds).blocks)
    toast.push(`Сгруппировано блоков: ${editableIds.length}`)
  }

  const ungroupSelection = () => {
    if (!page) return
    const ids = selectedIds
    updatePage((blocks) => ungroupBlocks(blocks, ids))
    toast.push('Группа разобрана')
  }

  /** Опорный блок массовых операций — активный, иначе первый по порядку чтения. */
  const massAnchor = () => {
    const blocks = page?.blocks ?? []
    return blocks.find((b) => b.id === selectedId) ?? blocks.find((b) => editableIds.includes(b.id)) ?? null
  }

  /** «Одинаковая ширина/высота»: размер опорного блока раздаём остальным выделенным. */
  const sameSize = (axis: 'w' | 'h') => {
    const anchor = massAnchor()
    if (!page || !anchor || editableIds.length < 2) return
    const value = axis === 'w' ? anchor.wPct : anchor.hPct
    updatePage((blocks) =>
      blocks.map((b) =>
        editableIds.includes(b.id)
          ? { ...b, ...clampRect({ ...b, ...(axis === 'w' ? { wPct: value } : { hPct: value }) }) }
          : b,
      ),
    )
    toast.push(axis === 'w' ? 'Ширина выровнена по опорному блоку' : 'Высота выровнена по опорному блоку')
  }

  /** Массовый кегль: сдвигаем размер шрифта всех выделенных блоков с текстом. */
  const bulkFontSize = (delta: number) => {
    if (!page) return
    let touched = 0
    updatePage((blocks) =>
      blocks.map((b) => {
        if (!editableIds.includes(b.id) || b.type === 'divider') return b
        touched += 1
        const next = Math.min(72, Math.max(5, Math.round((b.fontSizePt + delta) * 10) / 10))
        return { ...b, fontSizePt: next }
      }),
    )
    if (touched) toast.push(`Кегль изменён на ${delta > 0 ? '+' : ''}${delta} pt у блоков: ${touched}`)
  }

  const bulkFamily = (family: string) => {
    if (!page) return
    updatePage((blocks) =>
      blocks.map((b) => (editableIds.includes(b.id) && b.type !== 'divider' ? { ...b, fontFamily: family } : b)),
    )
    toast.push(`Семейство применено к блокам: ${editableIds.length}`)
  }

  /** Стиль = то, что переносится на другие блоки: кегль, выравнивание, шрифт, интервалы, регистр. */
  const styleBuffer = useRef<Partial<MenuBlock> | null>(null)
  const takeStyle = () => {
    const b = page?.blocks.find((x) => x.id === selectedId)
    if (!b) return
    styleBuffer.current = {
      fontSizePt: b.fontSizePt,
      align: b.align,
      bold: b.bold,
      lineHeight: b.lineHeight ?? 1.15,
      tracking: b.tracking ?? 0,
      uppercase: !!b.uppercase,
    }
    toast.push('Стиль скопирован — выделите блоки и нажмите «Применить стиль»')
  }
  const applyStyle = () => {
    const style = styleBuffer.current
    if (!style || !page) return
    const ids = selectedIds.length ? selectedIds : []
    if (ids.length === 0) return
    updatePage((blocks) => blocks.map((b) => (ids.includes(b.id) ? { ...b, ...style } : b)))
    toast.push(`Стиль применён к блокам: ${ids.length}`)
  }

  /** «Вписать текст»: подбираем кегль, пока текст не помещается в рамку блока. */
  const autofitText = (id: string) => {
    const b = page?.blocks.find((x) => x.id === id)
    if (!b) return
    const text = typograph(b.displayName ?? b.titleOverride ?? b.text ?? b.snapshotName ?? '')
    if (!text) {
      toast.push('В блоке нет текста', 'bad')
      return
    }
    const ratio = LAYOUT_FORMATS.find((f) => f.id === format)?.ratio ?? 210 / 297
    const measurer = domTextMeasurer({
      text,
      widthPct: b.wPct,
      heightPct: b.hPct,
      fontFamily: b.bold ? 'Unbounded' : 'Golos Text',
      bold: b.bold,
      lineHeight: b.lineHeight ?? 1.15,
      tracking: b.tracking ?? 0,
      ratio,
    })
    const next = fitFontSize(measurer.fits, b.fontSizePt, 6, 0.5)
    measurer.cleanup()
    patchBlock({ fontSizePt: next }, id)
    toast.push(next < b.fontSizePt ? `Кегль уменьшен до ${next} pt — текст влез` : 'Текст уже помещается')
  }

  /** Кадр фото: масштаб и точка фокуса. Один и тот же блок настроек для фото и позиции. */
  const cropControls = (block: MenuBlock) => {
    const crop = block.photoCrop ?? { zoom: 1, x: 0.5, y: 0.5 }
    const setCrop = (next: { zoom: number; x: number; y: number } | null) => patchBlock({ photoCrop: next }, block.id)
    return (
      <div className="mt-2 rounded-lg border border-line p-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[12px] text-ink-secondary">Кадрирование</span>
          <button
            type="button"
            onClick={() => setCrop(null)}
            className="text-[11px] text-ink-tertiary hover:text-brand"
            disabled={!block.photoCrop}
          >
            сбросить
          </button>
        </div>
        <label className="block text-[11px] text-ink-tertiary">
          масштаб ×{crop.zoom.toFixed(1)}
          <input
            type="range"
            min={1}
            max={3}
            step={0.1}
            value={crop.zoom}
            onChange={(e) => setCrop({ ...crop, zoom: Number(e.target.value) })}
            className="mt-1 w-full"
            aria-label="Масштаб кадра"
          />
        </label>
        <div className="mt-1.5 grid w-[72px] grid-cols-3 gap-0.5" role="group" aria-label="Точка фокуса">
          {[0, 0.5, 1].map((y) =>
            [0, 0.5, 1].map((x) => (
              <button
                key={`${x}-${y}`}
                type="button"
                onClick={() => setCrop({ ...crop, x, y })}
                aria-label={`Фокус ${Math.round(x * 100)}% / ${Math.round(y * 100)}%`}
                aria-pressed={Math.abs(crop.x - x) < 0.01 && Math.abs(crop.y - y) < 0.01}
                className={cx(
                  'h-5 w-5 rounded-sm border',
                  Math.abs(crop.x - x) < 0.01 && Math.abs(crop.y - y) < 0.01 ? 'border-brand bg-brand/20' : 'border-line hover:border-brand/50',
                )}
              />
            )),
          )}
        </div>
      </div>
    )
  }

  const toggleLock = (id: string) => {
    const b = page?.blocks.find((x) => x.id === id)
    if (!b) return
    patchBlock({ locked: !b.locked }, id)
    toast.push(!b.locked ? `«${layerName(b)}» закреплён` : `«${layerName(b)}» снова можно двигать`)
  }

  /** Копия блока со смещением — так работает ⌘D и ⌘C/⌘V. */
  const duplicateBlocks = useCallback(
    (ids: string[], offset = 2) => {
      if (!page || ids.length === 0) return
      const source = page.blocks.filter((b) => ids.includes(b.id))
      if (source.length === 0) return
      const copies = source.map((b) => ({
        ...b,
        id: `${b.type}-${Math.random().toString(36).slice(2, 9)}`,
        ...clampRect({ xPct: b.xPct + offset, yPct: b.yPct + offset, wPct: b.wPct, hPct: b.hPct }),
      }))
      updatePage((blocks) => [...blocks, ...copies.map((c) => ({ ...c, zIndex: topZ(blocks) + 1 }))])
      setSelectedIds(copies.map((c) => c.id))
      setSelectedId(copies[0]!.id)
      toast.push(copies.length > 1 ? `Дублировано блоков: ${copies.length}` : 'Блок продублирован')
    },
    [page, updatePage, toast],
  )

  // ── мастер-стили блоков (P2-2) ────────────────────────────────
  /** Блоки, к которым применяется стиль: всё выделение или активный блок. */
  const styleTargets = selectedIds.length ? selectedIds : selectedId ? [selectedId] : []
  const styles = doc?.styles ?? []
  const boundStyle = doc ? blockStyle(doc, selected) : null

  const bindSelectedToStyle = (styleId: string) => {
    if (!doc || styleTargets.length === 0) return
    const style = styles.find((s) => s.id === styleId)
    if (!style) return
    mutate(bindBlocks(doc, styleTargets, styleId))
    toast.push(
      styleTargets.length > 1
        ? `Стиль «${style.name}» применён к блокам: ${styleTargets.length}`
        : `Стиль «${style.name}» применён`,
    )
  }

  const detachSelectedFromStyle = () => {
    if (!doc || styleTargets.length === 0) return
    mutate(detachBlocks(doc, styleTargets))
    toast.push('Блок больше не следует за стилем — значения остались')
  }

  /** Сохранить текущий вид блока как новый стиль и привязать к нему выделение. */
  const createStyleFromBlock = () => {
    if (!doc || !selected) return
    const style = styleFromBlock(newStyleName || layerName(selected), selected)
    const next = bindBlocks({ ...doc, styles: [...styles, style] }, styleTargets, style.id)
    mutate(next)
    setNewStyleName('')
    toast.push(`Стиль «${style.name}» создан — блоков: ${styleTargets.length}`)
  }

  /** Обновить стиль по активному блоку: остальные привязанные блоки подтянутся. */
  const refreshStyleFromBlock = () => {
    if (!doc || !selected || !boundStyle) return
    mutate(updateStyle(doc, boundStyle.id, stylePropsOf(selected)))
    toast.push(`Стиль «${boundStyle.name}» обновлён: блоков ${styleUsage(doc, boundStyle.id)}`)
  }

  const deleteStyle = (styleId: string) => {
    if (!doc) return
    const style = styles.find((s) => s.id === styleId)
    const used = styleUsage(doc, styleId)
    mutate(removeStyle(doc, styleId))
    toast.push(
      used > 0
        ? `Стиль «${style?.name ?? 'Стиль'}» удалён — ${used} блок(ов) остались со своими настройками`
        : `Стиль «${style?.name ?? 'Стиль'}» удалён`,
    )
  }

  // ── автосохранение ────────────────────────────────────────────
  // Очередь из одного запроса: таймер, счётчик версий (устаревший ответ не перебивает новый)
  // и flush() перед серверными операциями, которые перезаписывают документ.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveSeq = useRef(0)
  const pending = useRef<{ payload: string; body: SaveBody } | null>(null)
  const latest = useRef<{ body: SaveBody; payload: string } | null>(null)

  const persist = useCallback(
    (payload: string, body: SaveBody) => {
      const seq = ++saveSeq.current
      setSave('saving')
      return api<{ layout: ServerLayout; savedAt: number }>(`/menu-layouts/${numericId}`, {
        method: 'PUT',
        body: { ...body, baseRev: revRef.current },
      })
        .then((res) => {
          if (seq !== saveSeq.current) return
          revRef.current = res.layout.rev
          setConflict(null)
          lastSaved.current = payload
          pending.current = null
          setSave('saved')
          setSavedAt(res.savedAt)
          setDrift(res.layout.drift)
          // Сохранено на сервере — локальный черновик больше не нужен.
          try {
            localStorage.removeItem(`menu-layout-draft-${numericId}`)
          } catch {
            /* приватный режим */
          }
        })
        .catch((e: unknown) => {
          if (seq !== saveSeq.current) return
          setSave('error')
          if (e instanceof ApiError && e.status === 409) {
            // Кто-то сохранил раньше: показываем выбор, а не молча затираем.
            setConflict({ rev: revRef.current })
            toast.push('Макет изменили в другом окне — выберите, чью версию оставить', 'bad')
            return
          }
          toast.push(e instanceof Error ? e.message : 'Не удалось сохранить макет', 'bad')
        })
    },
    [numericId, toast],
  )

  /** Дослать несохранённое немедленно: перед seed/sync/freeze и при уходе со страницы. */
  const flush = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const job = pending.current
    if (!job) return
    if (job.payload === lastSaved.current) {
      pending.current = null
      return
    }
    await persist(job.payload, job.body)
  }, [persist])

  /** Владелец выбрал «моя версия главнее»: берём актуальный rev и перезаписываем. */
  const overwriteMine = useCallback(async () => {
    try {
      const fresh = await api<{ layout: ServerLayout }>(`/menu-layouts/${numericId}`)
      revRef.current = fresh.layout.rev
      setConflict(null)
      const job = pending.current ?? latest.current
      if (job) await persist(job.payload, job.body)
      else setSave('saved')
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось перезаписать макет', 'bad')
    }
  }, [numericId, persist, toast])

  /** «Взять серверную»: принудительно перечитываем макет (hydrate не сработает сам — id тот же). */
  const takeServerVersion = useCallback(() => {
    hydrated.current = null
    setConflict(null)
    reload()
  }, [reload])

  useEffect(() => {
    if (!doc) return
    if (conflict) return // пока владелец не выбрал версию, ничего не пишем
    const body: SaveBody = { title: title.trim() || 'Без названия', theme, doc: docPayload(doc) }
    const payload = JSON.stringify(body)
    latest.current = { body, payload }
    if (payload === lastSaved.current) {
      pending.current = null
      return
    }
    setSave('dirty')
    pending.current = { payload, body }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      const job = pending.current
      if (job && job.payload !== lastSaved.current) void persist(job.payload, job.body)
    }, AUTOSAVE_MS)
  }, [doc, theme, title, numericId, persist, conflict])

  // Ушёл со страницы или свернул вкладку — правки последних 0,8 с не должны пропасть.
  useEffect(() => {
    const flushOnHide = () => {
      const job = pending.current
      if (!job || job.payload === lastSaved.current) return
      try {
        fetch(`/api/admin/menu-layouts/${numericId}`, {
          method: 'PUT',
          keepalive: true,
          headers: { 'Content-Type': 'application/json', 'X-Admin-Token': tokenStore.get() },
          body: JSON.stringify(job.body),
        }).catch(() => {})
        lastSaved.current = job.payload
      } catch {
        /* страница уже уходит — молча */
      }
    }
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flushOnHide()
    }
    window.addEventListener('pagehide', flushOnHide)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.removeEventListener('pagehide', flushOnHide)
      document.removeEventListener('visibilitychange', onHidden)
      flushOnHide()
    }
  }, [numericId])

  const undo = useCallback(() => {
    if (!doc) return
    const step = undoStep(history, doc)
    if (!step) return
    setHistory(step.history)
    setDoc(step.doc)
    setSave('dirty')
  }, [doc, history])

  const redo = useCallback(() => {
    if (!doc) return
    const step = redoStep(history, doc)
    if (!step) return
    setHistory(step.history)
    setDoc(step.doc)
    setSave('dirty')
  }, [doc, history])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /input|textarea|select/i.test(target.tagName)) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
        setPaletteQuery('')
        setPaletteIndex(0)
        return
      }
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
        return
      }
      if (e.key === 'Escape') {
        setCtxMenu(null)
        setRenamingId(null)
        setPaletteOpen(false)
        setSelectedIds([])
        setSelectedId(null)
        return
      }
      if (e.key === 'Enter' && selectedId) {
        // Enter на блоке — открыть его свойства, как двойной клик в фигме.
        setRightTab('block')
        return
      }
      if (mod && e.key.toLowerCase() === 'c' && selectedIds.length) {
        const b = page?.blocks.find((x) => x.id === selectedId) ?? page?.blocks.find((x) => x.id === selectedIds[0])
        if (b) clipboard.current = b
        e.preventDefault()
        return
      }
      if (mod && e.key.toLowerCase() === 'v' && clipboard.current) {
        e.preventDefault()
        const src = clipboard.current
        const copy = {
          ...src,
          id: `${src.type}-${Math.random().toString(36).slice(2, 9)}`,
          ...clampRect({ xPct: src.xPct + 2, yPct: src.yPct + 2, wPct: src.wPct, hPct: src.hPct }),
        }
        updatePage((blocks) => [...blocks, { ...copy, zIndex: topZ(blocks) + 1 }])
        setSelectedId(copy.id)
        setSelectedIds([copy.id])
        toast.push('Блок вставлен')
        return
      }
      if (mod && e.key.toLowerCase() === 'd' && selectedIds.length) {
        e.preventDefault()
        duplicateBlocks(selectedIds.length ? selectedIds : selectedId ? [selectedId] : [])
        return
      }
      if (mod && e.key.toLowerCase() === 'a' && page) {
        e.preventDefault()
        const all = page.blocks.map((b) => b.id)
        setSelectedIds(all)
        setSelectedId(all[0] ?? null)
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length) {
        e.preventDefault()
        if (e.altKey) updatePage((blocks) => blocks.map((b) => (selectedIds.includes(b.id) ? { ...b, hidden: !b.hidden } : b)))
        else {
          const ids = [...selectedIds]
          updatePage((blocks) => blocks.filter((b) => !ids.includes(b.id)))
          setSelectedIds([])
          setSelectedId(null)
          toast.push(ids.length > 1 ? `Убрано блоков: ${ids.length} — ⌘Z вернёт` : 'Блок убран с листа — ⌘Z вернёт')
        }
        return
      }
      if (!selectedId) return
      const step = e.shiftKey ? 5 : 0.5
      const nudge: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      }
      const d = nudge[e.key]
      if (d) {
        e.preventDefault()
        const ids = selectedIds.length ? selectedIds : [selectedId]
        updatePage((blocks) =>
          blocks.map((b) => (ids.includes(b.id) && !b.locked ? { ...b, ...clampRect(moveRect(b, d[0], d[1])) } : b)),
        )
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selectedId, selectedIds, undo, redo, updatePage, patchBlock, page, deleteBlock, duplicateBlocks, toast])

  // Панели: три зоны от 940 px, две зоны от 620 px (планшет), ниже — мобильные вкладки.
  // Ширину меряем у самого редактора: в админке слева рейл 244 px, поэтому на iPad
  // 1024 редактору достаётся ~730 px и брейкпоинт `lg` отправлял его в мобильный режим.
  const widthObserver = useRef<ResizeObserver | null>(null)
  const measureWidth = useCallback((node: HTMLElement | null) => {
    if (!node) return
    const width = node.getBoundingClientRect().width
    // Ноль бывает у отсоединённого узла — такую ширину не считаем раскладкой.
    if (width <= 0) return
    setMode(editorMode(width))
    if (width >= 940) setDrawerOpen(false)
  }, [])
  /** Ref-callback, а не эффект: узел пересоздаётся (скелетон → редактор, HMR). */
  const attachRoot = useCallback(
    (node: HTMLDivElement | null) => {
      widthObserver.current?.disconnect()
      widthObserver.current = null
      rootRef.current = node
      if (!node) return
      measureWidth(node)
      if (typeof ResizeObserver === 'undefined') return
      const ro = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width ?? 0
        if (width > 0) measureWidth(node)
      })
      ro.observe(node)
      widthObserver.current = ro
    },
    [measureWidth],
  )
  useEffect(() => {
    const onResize = () => measureWidth(rootRef.current)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [measureWidth])

  // Esc закрывает шторку с левой панелью.
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  // Локальный черновик: пишем раз в полсекунды, чтобы падение вкладки не съело правки.
  useEffect(() => {
    if (!doc || !numericId) return
    const body: SaveBody = { title, theme, doc }
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(`menu-layout-draft-${numericId}`, JSON.stringify({ body, savedAt: Date.now() }))
      } catch {
        /* место в localStorage кончилось — не повод падать */
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [doc, theme, title, numericId])

  const restoreDraft = () => {
    if (!draftOffer) return
    setDoc(docSnapshot(draftOffer.body.doc))
    setTheme({ ...DEFAULT_THEME, ...draftOffer.body.theme })
    setTitle(draftOffer.body.title)
    setHistory(emptyHistory())
    setSave('dirty')
    setDraftOffer(null)
    toast.push('Черновик восстановлен — проверьте лист и сохраните')
  }

  const dropDraft = () => {
    if (numericId) localStorage.removeItem(`menu-layout-draft-${numericId}`)
    setDraftOffer(null)
  }

  // ── перетаскивание и размер ────────────────────────────────────
  const beginDrag = (e: ReactPointerEvent<HTMLDivElement>, id: string, mode: 'move' | 'resize', handle: ResizeHandle = 'se') => {
    const block = page?.blocks.find((b) => b.id === id)
    const sheet = sheetRef.current
    if (!block || !sheet) return
    // Замок: блок выделяется, но жест не начинается.
    if (block.locked) return
    const safe = safeBoxSize(sheet.getBoundingClientRect())
    // Тянем всё выделение, но только незаблокированные блоки.
    const ids = mode === 'move' && selectedIds.includes(id) ? selectedIds : [id]
    const rects = (page?.blocks ?? [])
      .filter((b) => ids.includes(b.id) && !b.locked)
      .map((b) => ({ id: b.id, rect: { xPct: b.xPct, yPct: b.yPct, wPct: b.wPct, hPct: b.hPct }, locked: !!b.locked }))
    drag.current = {
      id,
      mode,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      rects: rects.length ? rects : [{ id, rect: { xPct: block.xPct, yPct: block.yPct, wPct: block.wPct, hPct: block.hPct }, locked: false }],
      // Проценты в документе считаются от безопасной области, а не от края листа.
      w: safe.w,
      h: safe.h,
      pushed: false,
    }
    setCtxMenu(null)
    perfDragStart()
    // Shift/⌘ добавляют блок к выделению и не сбрасывают остальные.
    if (!(e.shiftKey || e.metaKey || e.ctrlKey)) {
      // Уже в выделении (группа, мультивыбор) — не схлопываем его до одного блока.
      setSelectedIds((cur) => (cur.includes(id) ? cur : [id]))
    }
    setSelectedId(id)
    updatePage((blocks) => (blocks.find((b) => b.id === id)?.zIndex === topZ(blocks) - 1 ? blocks : bringToFront(blocks, id)))
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  // Обработчик перетаскивания не пересоздаётся на каждое изменение сетки — читаем через ref.
  const showGridRef = useRef(showGrid)
  const gridRef = useRef({ stepPct: gridStep, cols: gridCols })
  useEffect(() => {
    showGridRef.current = showGrid
  }, [showGrid])
  useEffect(() => {
    gridRef.current = { stepPct: gridStep, cols: gridCols }
  }, [gridStep, gridCols])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      perfFrame()
      const dxPct = ((e.clientX - d.startX) / d.w) * 100
      const dyPct = ((e.clientY - d.startY) / d.h) * 100
      const primary = d.rects.find((r) => r.id === d.id)?.rect ?? d.rects[0]!.rect
      const others = (page?.blocks ?? []).filter((b) => !d.rects.some((r) => r.id === b.id) && !b.hidden)
      let next: Rect =
        d.mode === 'move'
          ? moveRect(primary, e.shiftKey && Math.abs(dxPct) < Math.abs(dyPct) ? 0 : dxPct, e.shiftKey && Math.abs(dyPct) <= Math.abs(dxPct) ? 0 : dyPct)
          : resizeRect(primary, d.handle, dxPct, dyPct)
      // Прилипание к полям и соседям: Alt отключает, чтобы можно было поставить «как хочу».
      if (d.mode === 'move' && !e.altKey) {
        const snapped = snapWithGuides(next, others, 0.8)
        next = snapped.rect
        // Сетка включена — доводим до её линий, если соседи не поймали блок.
        const caught = snapped.guides.x.length + snapped.guides.y.length > 0
        if (showGridRef.current && !caught) next = snapToGrid(next, gridRef.current)
        setGuides(snapped.guides)
      }
      const shiftX = next.xPct - primary.xPct
      const shiftY = next.yPct - primary.yPct
      updatePage(
        (blocks) =>
          blocks.map((b) => {
            const item = d.rects.find((r) => r.id === b.id)
            if (!item) return b
            if (b.id === d.id) return { ...b, ...next }
            // Остальные блоки выделения едут тем же сдвигом.
            return { ...b, ...clampRect({ xPct: item.rect.xPct + shiftX, yPct: item.rect.yPct + shiftY, wPct: b.wPct, hPct: b.hPct }) }
          }),
        { history: !d.pushed },
      )
      d.pushed = true
    }
    const onUp = () => {
      if (drag.current) perfDragEnd()
      drag.current = null
      setGuides({ x: [], y: [] })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [updatePage])

  // ── действия с блоками ────────────────────────────────────────
  /** Из каталога в выбранную секцию «Мест» (если секции есть и включён v2). */
  const addToPlaces = (p: CatalogProduct, sectionId: string | null) => {
    if (!doc) return
    // Один товар — одна позиция: клик по уже добавленному не плодит дубль на печати.
    const found = findItemByProduct(doc, p.id)
    if (found) {
      setLeftTab('places')
      setSelectedId(`p-${found.item.id}`)
      toast.push(`«${p.name}» уже в «Местах»`)
      return
    }
    void applySections(addItemToSection(doc, sectionId, p))
    toast.push(`«${p.name}» добавлен в «Места»`)
  }

  const addProduct = (p: CatalogProduct) => {
    // Одна позиция — один блок. Объёмы (250/350/400) в каталоге — отдельные товары
    // с общим groupId, на листе это одна позиция, поэтому ищем и по группе.
    const key = groupKeyOf(p)
    const sameKey = (b: MenuBlock) => {
      if (b.type !== 'product' || b.hidden || b.productId == null) return false
      if (b.productId === p.id) return true
      if (!p.groupId) return false
      const other = products.find((x) => x.id === b.productId)
      return !!other && groupKeyOf(other) === key
    }
    const existing = doc?.pages.flatMap((pg) => pg.blocks).find(sameKey)
    if (existing) {
      setSelectedId(existing.id)
      setSelectedIds([existing.id])
      setRightTab('block')
      const samePage = doc?.pages.findIndex((pg) => pg.blocks.some((b) => b.id === existing.id)) ?? -1
      if (samePage >= 0) setPageIdx(samePage)
      toast.push(`«${p.name}» уже на листе — выделил блок`)
      return
    }
    // В блок кладём вариант с младшим объёмом: название и объёмы берутся из каталога.
    const group = p.groupId ? products.filter((x) => groupKeyOf(x) === key) : [p]
    const primary = group.find((x) => x.available) ?? group[0] ?? p
    const fresh = productBlock(primary, {}, 0)
    updatePage((blocks) => {
      const rect = nextFreeRect(blocks, DEFAULT_RECT.product.w, DEFAULT_RECT.product.h)
      return [...blocks, { ...fresh, ...rect, zIndex: topZ(blocks) }]
    })
    setSelectedId(fresh.id)
    setRightTab('block')
    toast.push(`«${p.name}» добавлен на лист`)
  }

  const addBlock = (type: BlockType, extra: Partial<MenuBlock> = {}) => {
    const fresh = newBlock(type, {}, extra)
    updatePage((blocks) => {
      const rect = nextFreeRect(blocks, DEFAULT_RECT[type].w, DEFAULT_RECT[type].h)
      return [...blocks, { ...fresh, ...rect, zIndex: topZ(blocks) }]
    })
    setSelectedId(fresh.id)
    setRightTab('block')
  }

  /** Картинка блока — только файл из админки: внешние ссылки сервер не примет. */
  const setImageUrl = (value: string, field: 'url' | 'photoUrlOverride') => {
    const v = value.trim()
    if (!v) {
      patchBlock({ [field]: null } as Partial<MenuBlock>)
      return
    }
    if (!isUploadsUrl(v)) {
      toast.push('Только файл из админки: загрузите картинку кнопкой «Загрузить»', 'bad')
      return
    }
    patchBlock({ [field]: v } as Partial<MenuBlock>)
  }

  const dupes = useMemo(() => (doc ? duplicateProducts(doc) : []), [doc])

  const removeDuplicates = () => {
    if (!doc) return
    const next = collapseDuplicateProducts(doc)
    const removed = doc.pages.reduce((n, p) => n + p.blocks.length, 0) - next.pages.reduce((n, p) => n + p.blocks.length, 0)
    if (removed === 0) return
    mutate(next)
    setSelectedId(null)
    toast.push(`Убрано дублей: ${removed}`)
  }

  const uploadInto = async (file: File, apply: (url: string) => void, full = false) => {
    setBusyUpload(true)
    try {
      const res = await uploadFile(file)
      // Для печати нужен максимум доступного разрешения: 480 px на поллиста — мыло.
      apply(full ? res.urlFull ?? res.url : res.url)
      toast.push('Картинка загружена')
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось загрузить картинку', 'bad')
    } finally {
      setBusyUpload(false)
    }
  }

  /** Статус листа (черновик / готов к печати) — это поле макета, а не состояние сохранения. */
  const setLayoutStatus = async (next: 'draft' | 'ready') => {
    try {
      const res = await api<{ layout: ServerLayout; savedAt?: number }>(`/menu-layouts/${numericId}`, {
        method: 'PUT',
        body: { status: next },
      })
      setStatus(res.layout.status)
      if (res.savedAt) setSavedAt(res.savedAt)
      toast.push(next === 'ready' ? 'Лист отмечен готовым к печати' : 'Лист снова черновик')
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось сменить статус', 'bad')
    }
  }

  const seedFromCatalog = async () => {
    try {
      // Сначала досылаем свои правки: сервер вернёт документ и перезапишет локальный.
      await flush()
      const res = await api<{ layout: ServerLayout; added: number; skippedDuplicate?: number }>(
        `/menu-layouts/${numericId}/seed-from-catalog`,
        { method: 'POST', body: { pageId: page?.id, replace: false } },
      )
      hydrated.current = res.layout.id
      setDoc(docSnapshot(res.layout.doc))
      setHistory(emptyHistory())
      setDrift(res.layout.drift)
      lastSaved.current = JSON.stringify({ title: res.layout.title, theme: res.layout.theme, doc: docSnapshot(res.layout.doc) })
      const skipped = res.skippedDuplicate ?? 0
      toast.push(
        `Добавлено ${res.added}${skipped ? `, пропущено дублей ${skipped}` : ''}`,
      )
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось собрать из каталога', 'bad')
    }
  }

  /** Пересобрать лист из секций (движок раскладки): переносит позиции на новую страницу. */
  const relayout = async () => {
    try {
      await flush()
      const res = await api<{ layout: ServerLayout; dropped: number }>(`/menu-layouts/${numericId}/layout`, {
        method: 'POST',
        body: { baseRev: revRef.current },
      })
      revRef.current = res.layout.rev
      setDoc(docSnapshot(res.layout.doc))
      setHistory(emptyHistory())
      setDrift(res.layout.drift)
      lastSaved.current = JSON.stringify({ title: res.layout.title, theme: res.layout.theme, doc: docSnapshot(res.layout.doc) })
      toast.push(res.dropped ? `Лист пересобран, не влезло позиций: ${res.dropped}` : 'Лист пересобран по секциям')
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось пересобрать лист', 'bad')
    }
  }

  const syncPrices = async () => {
    try {
      await flush()
      const res = await api<{ changed: unknown[]; layout: ServerLayout }>(`/menu-layouts/${numericId}/sync-prices`, {
        method: 'POST',
        body: {},
      })
      setDoc(docSnapshot(res.layout.doc))
      setHistory(emptyHistory())
      setDrift(res.layout.drift)
      lastSaved.current = JSON.stringify({ title: res.layout.title, theme: res.layout.theme, doc: docSnapshot(res.layout.doc) })
      toast.push(res.changed.length ? `Обновлено цен: ${res.changed.length}` : 'Цены уже совпадают с каталогом')
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось обновить цены', 'bad')
    }
  }

  const setFrozen = async (mode: 'live' | 'frozen') => {
    try {
      await flush()
      const res = await api<{ layout: ServerLayout }>(`/menu-layouts/${numericId}`, { method: 'PUT', body: { priceMode: mode } })
      setDoc(docSnapshot(res.layout.doc))
      setHistory(emptyHistory())
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
    // `...doc` — чтобы стили блоков и прочие поля не терялись при работе со страницами.
    mutate({ ...doc, pages: [...doc.pages, { id: `page-${Date.now().toString(36)}`, blocks: [] }] })
    setPageIdx(doc.pages.length)
  }

  const removePage = (idx: number) => {
    if (!doc || doc.pages.length <= 1) return
    mutate({ ...doc, pages: doc.pages.filter((_, i) => i !== idx) })
    setPageIdx(Math.max(0, idx - 1))
  }

  if (loading && !data) return <EditorSkeleton />
  if (error) return <ErrorBox message={error} onRetry={reload} />
  if (!doc || !previewPage || !page) {
    // Скелетон тоже внутри измерителя: иначе ширина станет известна только после загрузки.
    return (
      <div ref={attachRoot}>
        <EditorSkeleton />
      </div>
    )
  }

  const format = data?.layout.format ?? 'a4_portrait'
  const ratio = LAYOUT_FORMATS.find((f) => f.id === format)?.ratio ?? 210 / 297
  const filtered = products.filter((p) => {
    // По умолчанию в каталоге слева только то, что реально продаётся.
    if (!showAllProducts && !p.available) return false
    if (catFilter !== 'all' && p.categoryId !== catFilter) return false
    if (!search.trim()) return true
    return p.name.toLowerCase().includes(search.trim().toLowerCase())
  })

  const statusLabel = status === 'ready' ? 'Готово к печати' : 'Черновик'
  const saveStateText =
    save === 'saving'
      ? 'сохраняем…'
      : save === 'error'
        ? 'не сохранено'
        : save === 'dirty'
          ? 'есть несохранённые изменения'
          : savedAt
            ? `сохранено ${ago(savedAt)}`
            : 'сохранено'
  /** Команды палитры: те же действия, что в панелях, но без поиска мышью. */
  const commands: { id: string; title: string; hint?: string; run: () => void }[] = [
    { id: 'text', title: 'Добавить текст', run: () => addBlock('text') },
    { id: 'photo', title: 'Добавить фото', run: () => addBlock('image') },
    { id: 'logo', title: 'Добавить логотип', run: () => addBlock('logo') },
    { id: 'divider', title: 'Добавить линию', run: () => addBlock('divider') },
    { id: 'seed', title: 'Собрать лист из каталога', run: () => void seedFromCatalog() },
    { id: 'export', title: 'Экспорт PDF', hint: 'файл для типографии', run: () => setExportOpen(true) },
    { id: 'preview', title: 'Предпросмотр', run: () => setPreviewOpen(true) },
    { id: 'versions', title: 'Версии макета', run: () => setVersionsOpen(true) },
    { id: 'version-save', title: 'Сохранить версию', run: () => void saveVersion() },
    { id: 'grid', title: showGrid ? 'Выключить сетку' : 'Включить сетку', run: () => setShowGrid((v) => !v) },
    { id: 'fit', title: 'Вписать лист', run: () => setZoom(1) },
    { id: 'format', title: 'Сменить формат листа', run: () => setFormatOpen(true) },
    { id: 'palettes', title: 'Палитры бренда', run: () => setRightTab('design') },
    { id: 'group', title: 'Сгруппировать выделение', run: groupSelection },
    { id: 'ungroup', title: 'Разгруппировать', run: ungroupSelection },
    { id: 'columns2', title: 'Разложить в 2 колонки', run: () => columns(2) },
    { id: 'duplicate', title: 'Дублировать блок', hint: '⌘D', run: () => duplicateBlocks(selectedIds) },
    { id: 'delete', title: 'Убрать блок с листа', hint: 'Del', run: () => selectedId && deleteBlock(selectedId) },
  ]
  const paletteItems = commands.filter((c) => !paletteQuery || c.title.toLowerCase().includes(paletteQuery.toLowerCase()))
  const runCommand = (index: number) => {
    const cmd = paletteItems[index]
    if (!cmd) return
    cmd.run()
    setPaletteOpen(false)
    setPaletteQuery('')
  }

  const driftText = driftBanner(drift.length ? drift : liveDrift, priceMode)
  const selectedType = selected ? effectiveType(selected) : null

  const canvas = (opts: { interactive?: boolean; grid?: boolean; safe?: boolean } = {}) => (
    <MenuCanvas
      page={previewPage}
      theme={theme}
      title={title}
      selectedId={opts.interactive ? selectedId : null}
      selectedIds={opts.interactive ? selectedIds : undefined}
      guides={opts.interactive ? guides : undefined}
      marquee={opts.interactive ? marquee : null}
      onSelect={opts.interactive ? selectBlock : undefined}
      onBlockPointerDown={opts.interactive ? (e, bid) => beginDrag(e, bid, 'move') : undefined}
      onHandlePointerDown={opts.interactive ? (e, bid) => beginDrag(e, bid, 'resize', 'se') : undefined}
      onContextMenu={opts.interactive ? (e, bid) => setCtxMenu({ x: e.clientX, y: e.clientY, id: bid }) : undefined}
      showGrid={opts.grid}
      gridStepPct={gridStep}
      gridCols={gridCols}
      showSafe={opts.safe}
      index={pageIdx + 1}
      total={doc.pages.length}
    />
  )

  /* ── панели ── */

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
        <div className="mt-2 flex items-center gap-1 text-[11px] font-semibold">
          <button
            type="button"
            onClick={() => setShowAllProducts(false)}
            aria-pressed={!showAllProducts}
            className={cx(
              'rounded-full border px-2.5 py-1',
              !showAllProducts ? 'border-brand bg-brand text-white' : 'border-line text-ink-secondary',
            )}
          >
            Доступные
          </button>
          <button
            type="button"
            onClick={() => setShowAllProducts(true)}
            aria-pressed={showAllProducts}
            className={cx(
              'rounded-full border px-2.5 py-1',
              showAllProducts ? 'border-brand bg-brand text-white' : 'border-line text-ink-secondary',
            )}
          >
            Весь каталог
          </button>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
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
        <button
          type="button"
          onClick={() => void seedFromCatalog()}
          className="mt-2 w-full rounded-lg border border-dashed border-line px-2 py-1.5 text-[12px] font-semibold text-brand hover:border-brand"
        >
          Собрать лист из каталога
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {catalog.loading && !catalog.data && <Spinner label="Загрузка каталога…" />}
        {filtered.length === 0 && <p className="px-2 py-3 text-[13px] text-ink-secondary">Ничего не найдено.</p>}
        <ul className="space-y-1">
          {filtered.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => (MENU_LAYOUT_V2 && sections.length > 0 ? addToPlaces(p, sections[0]!.section.id) : addProduct(p))}
                className="flex w-full items-center gap-2 rounded-lg border border-transparent px-1.5 py-1.5 text-left hover:border-line hover:bg-surface-2"
              >
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt="" className="h-9 w-9 flex-none rounded-md bg-surface-2 object-cover" />
                ) : (
                  <span className="grid h-9 w-9 flex-none place-items-center rounded-md bg-surface-2 text-ink-tertiary">
                    <ImagePlus size={14} aria-hidden />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ink">{p.name}</span>
                  <span className="block truncate text-[11px] text-ink-tertiary">
                    {p.price} ₽{p.variantLabel ? ` · ${p.variantLabel}` : ''}
                    {!p.available ? ' · не в продаже' : ''}
                  </span>
                </span>
                <Plus size={15} className="flex-none text-brand" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-3 rounded-lg border border-dashed border-line p-2">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Добавить на холст</p>
          <div className="flex flex-wrap gap-1">
            {(
              [
                ['text', 'Текст'],
                ['image', 'Фото'],
                ['logo', 'Лого'],
                ['divider', 'Линия'],
              ] as [BlockType, string][]
            ).map(([t, label]) => (
              <button
                key={t}
                type="button"
                onClick={() => addBlock(t)}
                className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-secondary hover:border-brand hover:text-brand"
              >
                + {label}
              </button>
            ))}
          </div>
          {categories.length > 0 && (
            <>
              <p className="mt-2 mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">Заголовок категории</p>
              <div className="flex flex-wrap gap-1">
                {categories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => addBlock('category', { categoryId: c.id, titleOverride: c.name })}
                    className="rounded-full border border-line px-2 py-1 text-[11px] text-ink-secondary hover:border-brand hover:text-brand"
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )

  const layersPane = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line px-2 py-2">
        <label className="flex min-h-8 items-center gap-2 rounded-lg border border-line bg-white px-2">
          <Search size={13} className="text-ink-tertiary" aria-hidden />
          <input
            value={layerQuery}
            onChange={(e) => setLayerQuery(e.target.value)}
            placeholder="Найти слой"
            aria-label="Поиск по слоям"
            className="min-w-0 flex-1 border-0 bg-transparent text-[12.5px] outline-none"
          />
          {layerQuery && (
            <button type="button" onClick={() => setLayerQuery('')} aria-label="Очистить поиск" className="text-ink-tertiary hover:text-brand">
              <X size={13} />
            </button>
          )}
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
      {page.blocks.length === 0 && (
        <p className="p-2 text-[13px] text-ink-secondary">Холст пуст. Добавьте позиции из каталога или текст.</p>
      )}
      {page.blocks.length > 0 && layerQuery && byZ(page.blocks).filter((b) => layerName(b).toLowerCase().includes(layerQuery.toLowerCase())).length === 0 && (
        <p className="p-2 text-[12.5px] text-ink-secondary">Ничего не найдено по «{layerQuery}».</p>
      )}
      {(() => {
        const groups = new Map<string, MenuBlock[]>()
        for (const b of page.blocks) if (b.groupId) groups.set(b.groupId, [...(groups.get(b.groupId) ?? []), b])
        if (groups.size === 0) return null
        return (
          <ul className="mb-2 space-y-1">
            {[...groups.entries()].map(([gid, list]) => {
              const open = !collapsedGroups.includes(gid)
              return (
                <li key={gid} className="rounded-lg border border-line">
                  <div className="flex items-center gap-1 px-1.5 py-1">
                    <button
                      type="button"
                      onClick={() => setCollapsedGroups((cur) => (cur.includes(gid) ? cur.filter((x) => x !== gid) : [...cur, gid]))}
                      aria-expanded={open}
                      className="grid h-6 w-6 place-items-center rounded text-ink-tertiary hover:text-brand"
                      aria-label={open ? 'Свернуть группу' : 'Развернуть группу'}
                    >
                      {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedIds(list.map((b) => b.id))}
                      className="min-w-0 flex-1 truncate text-left text-[12.5px] font-semibold"
                    >
                      Группа · {list.length}
                    </button>
                    <button
                      type="button"
                      onClick={() => ungroupSelection()}
                      className="rounded px-1 text-[11px] text-ink-tertiary hover:text-brand"
                      title="Разгруппировать"
                    >
                      разбить
                    </button>
                  </div>
                  {open && (
                    <ul className="space-y-0.5 border-t border-line p-1">
                      {byZ(list).map((b) => (
                        <li key={b.id}>
                          <button
                            type="button"
                            onClick={() => selectBlock(b.id)}
                            className="w-full truncate rounded px-1 py-0.5 text-left text-[12px] text-ink-secondary hover:bg-surface-2 hover:text-brand"
                          >
                            {layerName(b)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        )
      })()}

      <ul className="space-y-0.5">
        {byZ(page.blocks)
          .filter((b) => !b.groupId)
          .filter((b) => !layerQuery || layerName(b).toLowerCase().includes(layerQuery.toLowerCase()))
          .map((b) => (
          <li
            key={b.id}
            draggable
            onDragStart={(e) => {
              setLayerDragId(b.id)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={(e) => {
              if (layerDragId && layerDragId !== b.id) e.preventDefault()
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (layerDragId && layerDragId !== b.id) {
                updatePage((blocks) => reorderBlocks(blocks, layerDragId, b.id))
              }
              setLayerDragId(null)
            }}
            onDragEnd={() => setLayerDragId(null)}
            className={cx(
              'flex items-center gap-1 rounded-lg border px-1.5 py-1',
              selectedIds.includes(b.id) ? 'border-brand bg-surface-2' : 'border-transparent hover:bg-surface-2',
              b.hidden && 'opacity-50',
              layerDragId === b.id && 'opacity-60',
            )}
          >
            <GripVertical size={12} className="flex-none text-ink-tertiary" aria-hidden />
            {renamingId === b.id ? (
              <input
                autoFocus
                defaultValue={b.titleOverride ?? layerName(b)}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (v) patchBlock({ titleOverride: v }, b.id)
                  setRenamingId(null)
                }}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') setRenamingId(null)
                }}
                aria-label="Новое имя слоя"
                className="min-w-0 flex-1 rounded border border-brand px-1 text-[12.5px] outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={(e) => selectBlock(b.id, e as unknown as ReactPointerEvent<HTMLDivElement>)}
                onDoubleClick={() => setRenamingId(b.id)}
                title="Двойной клик — переименовать (меняет и подпись на печати)"
                className="min-w-0 flex-1 truncate text-left text-[12.5px]"
              >
                <span className="text-ink-tertiary">{b.zIndex}.</span> {layerName(b)}
              </button>
            )}
            <button
              type="button"
              onClick={() => toggleLock(b.id)}
              className={cx('grid h-6 w-6 place-items-center rounded', b.locked ? 'text-brand' : 'text-ink-tertiary hover:text-brand')}
              aria-label={b.locked ? 'Снять замок' : 'Закрепить блок'}
              title={b.locked ? 'Снять замок' : 'Закрепить блок'}
            >
              {b.locked ? <Lock size={13} /> : <LockOpen size={13} />}
            </button>
            <button
              type="button"
              onClick={() => updatePage((blocks) => bringToFront(blocks, b.id))}
              className="grid h-6 w-6 place-items-center rounded text-ink-tertiary hover:text-brand"
              aria-label="На передний план"
              title="На передний план"
            >
              <ArrowUp size={13} />
            </button>
            <button
              type="button"
              onClick={() => updatePage((blocks) => sendToBack(blocks, b.id))}
              className="grid h-6 w-6 place-items-center rounded text-ink-tertiary hover:text-brand"
              aria-label="На задний план"
              title="На задний план"
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
            <button
              type="button"
              onClick={() => deleteBlock(b.id)}
              className="grid h-6 w-6 place-items-center rounded text-ink-tertiary hover:text-bad"
              aria-label={`Удалить «${blockLabel(b)}» с листа`}
              title="Удалить с листа"
            >
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ul>
      {dupes.length > 0 && (
        <div className="mt-2 rounded-lg border border-warn/40 bg-warn-soft p-2">
          <p className="text-[12px] text-warn">Дублей позиций: {dupes.length}. На печати они повторятся.</p>
          <button
            type="button"
            onClick={removeDuplicates}
            className="mt-1 text-[12px] font-semibold text-brand hover:underline"
          >
            Убрать дубли
          </button>
        </div>
      )}
      </div>
    </div>
  )

  // Осторожно: это после ранних return'ов, поэтому без useMemo — только вычисление.
  /** Сменить шаблон: раскладка пересобирается, позиции и секции остаются. */
  const applyTemplate = async (templateId: string) => {
    try {
      await flush()
      const res = await api<{ layout: ServerLayout; dropped: number }>(`/menu-layouts/${numericId}/layout`, {
        method: 'POST',
        body: { template: templateId, baseRev: revRef.current },
      })
      revRef.current = res.layout.rev
      setDoc(docSnapshot(res.layout.doc))
      setTheme({ ...DEFAULT_THEME, ...res.layout.theme })
      lastSaved.current = JSON.stringify({ title: res.layout.title, theme: res.layout.theme, doc: docSnapshot(res.layout.doc) })
      setFormatOpen(false)
      toast.push(`Шаблон применён: ${templates.find((t) => t.id === templateId)?.name ?? templateId}`)
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось применить шаблон', 'bad')
    }
  }

  const sections = doc ? docSections(doc) : []
  const templates = templatesData.data?.templates ?? []
  /** Любая правка «Мест» сразу пересобирает блоки на сервере — иначе лист разъедется с секциями. */
  const applySections = async (next: MenuDoc) => {
    mutate(next)
    try {
      // Сначала сохраняем секции, потом просим движок разложить их: /layout читает документ из БД.
      const body: SaveBody = { title: title.trim() || 'Без названия', theme, doc: docPayload(next) }
      const saved = await api<{ layout: ServerLayout; savedAt: number }>(`/menu-layouts/${numericId}`, {
        method: 'PUT',
        body: { ...body, baseRev: revRef.current },
      })
      revRef.current = saved.layout.rev
      const res = await api<{ layout: ServerLayout; dropped: number }>(`/menu-layouts/${numericId}/layout`, {
        method: 'POST',
        body: { baseRev: revRef.current },
      })
      revRef.current = res.layout.rev
      setDoc(docSnapshot(res.layout.doc))
      lastSaved.current = JSON.stringify({ title: res.layout.title, theme: res.layout.theme, doc: docSnapshot(res.layout.doc) })
      setSave('saved')
      setSavedAt(res.layout.updatedAt)
      if (res.dropped) toast.push(`Не влезло на лист позиций: ${res.dropped} — уменьшите шрифт или добавьте страницу`, 'bad')
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось пересобрать лист', 'bad')
    }
  }

  /** AI-помощник: предложение → подтверждение → применение. Модель документ не пишет. */
  const runAi = async () => {
    if (!aiPrompt.trim()) return
    setAiBusy(true)
    setAiPlan(null)
    try {
      const res = await api<{ plan: { summary: string; ops: unknown[] } }>(`/menu-layouts/${numericId}/ai/propose`, {
        method: 'POST',
        body: { prompt: aiPrompt.trim() },
      })
      if (res.plan.ops.length === 0) toast.push(res.plan.summary, 'bad')
      else setAiPlan(res.plan)
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'AI не ответил', 'bad')
    } finally {
      setAiBusy(false)
    }
  }

  const applyAiPlan = async () => {
    if (!aiPlan) return
    setAiBusy(true)
    try {
      await flush()
      const res = await api<{ layout: ServerLayout; changed: number; dropped: number }>(`/menu-layouts/${numericId}/ai/apply`, {
        method: 'POST',
        body: { ops: aiPlan.ops, baseRev: revRef.current },
      })
      revRef.current = res.layout.rev
      setDoc(docSnapshot(res.layout.doc))
      lastSaved.current = JSON.stringify({ title: res.layout.title, theme: res.layout.theme, doc: docSnapshot(res.layout.doc) })
      setAiPlan(null)
      setAiPrompt('')
      toast.push(`Применено изменений: ${res.changed}`)
    } catch (e) {
      toast.push(e instanceof Error ? e.message : 'Не удалось применить', 'bad')
    } finally {
      setAiBusy(false)
    }
  }

  /** «Места»: дерево секций и позиций — правим смысл, холст пересобирается сам. */
  const placesPane = (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      {sections.length === 0 && (
        <p className="p-2 text-[13px] text-ink-secondary">
          Секций пока нет. Нажмите «Собрать лист из каталога» — категории станут секциями, а позиции можно будет
          двигать списком.
        </p>
      )}
      <ul className="space-y-2">
        {sections.map(({ section }) => (
          <li key={section.id} className="rounded-lg border border-line">
            <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
              <input
                value={section.title}
                onChange={(e) => void applySections(renameSection(doc!, section.id, e.target.value))}
                aria-label={`Название секции ${section.title}`}
                className="min-w-0 flex-1 truncate border-0 bg-transparent text-[13px] font-semibold outline-none focus:underline"
              />
              <span className="flex-none text-[11px] text-ink-tertiary">{itemCount(section)}</span>
            </div>
            <ul className="space-y-0.5 p-1">
              {section.items.map((it, idx) => (
                <li
                  key={it.id}
                  className={cx(
                    'flex items-center gap-1 rounded px-1 py-0.5',
                    selectedId === `p-${it.id}` ? 'bg-surface-2' : 'hover:bg-surface-2',
                    it.hidden && 'opacity-50',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(`p-${it.id}`)}
                    className="min-w-0 flex-1 truncate text-left text-[12.5px]"
                  >
                    {it.titleOverride ?? catalogName(it.productId)}
                    {it.sizes.length > 1 && <span className="ml-1 text-ink-tertiary">· {it.sizes.length} объёма</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => void applySections(moveItem(doc!, section.id, it.id, -1))}
                    disabled={idx === 0}
                    className="grid h-6 w-6 place-items-center rounded text-ink-tertiary hover:text-brand disabled:opacity-30"
                    aria-label="Выше"
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void applySections(moveItem(doc!, section.id, it.id, 1))}
                    disabled={idx === section.items.length - 1}
                    className="grid h-6 w-6 place-items-center rounded text-ink-tertiary hover:text-brand disabled:opacity-30"
                    aria-label="Ниже"
                  >
                    <ArrowDown size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void applySections(toggleItemHidden(doc!, section.id, it.id))}
                    className="grid h-6 w-6 place-items-center rounded text-ink-tertiary hover:text-brand"
                    aria-label={it.hidden ? 'Вернуть в меню' : 'Убрать из меню'}
                  >
                    {it.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => void applySections(removeItem(doc!, section.id, it.id))}
                    className="grid h-6 w-6 place-items-center rounded text-ink-tertiary hover:text-bad"
                    aria-label="Удалить позицию"
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
              {section.items.length === 0 && <li className="px-1 py-1 text-[12px] text-ink-tertiary">Пусто</li>}
            </ul>
          </li>
        ))}
      </ul>
      {sections.length > 0 && (
        <button
          type="button"
          onClick={() => setLeftTab('catalog')}
          className="mt-2 w-full rounded-lg border border-dashed border-line px-2 py-1.5 text-[12px] font-semibold text-brand hover:border-brand"
        >
          Добавить позицию из каталога
        </button>
      )}
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

      {styles.length > 0 && (
        <section className="border-b border-line px-3 py-3">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-[13px] font-semibold">Стили блоков</h3>
            <span className="text-[11px] text-ink-tertiary">{styles.length}</span>
          </div>
          <ul className="space-y-1">
            {styles.map((s) => {
              const used = doc ? styleUsage(doc, s.id) : 0
              return (
                <li key={s.id} className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-semibold text-ink">{s.name}</span>
                    <span className="block text-[11px] text-ink-tertiary">
                      {s.fontSizePt} pt{used > 0 ? ` · блоков: ${used}` : ' · не используется'}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => bindSelectedToStyle(s.id)}
                    disabled={styleTargets.length === 0}
                    className="h-7 rounded-md px-2 text-[11px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-brand disabled:opacity-40"
                    title="Применить стиль к выделенным блокам"
                  >
                    применить
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteStyle(s.id)}
                    className="grid h-7 w-7 place-items-center rounded text-ink-tertiary hover:text-bad"
                    aria-label={`Удалить стиль ${s.name}`}
                    title="Удалить стиль"
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="mt-1.5 text-[11px] text-ink-tertiary">
            Стиль создаётся из выбранного блока на вкладке «Блок». Удаление стиля оставляет блокам их настройки.
          </p>
        </section>
      )}

      <section className="border-b border-line px-3 py-3">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-[13px] font-semibold">Шрифты и цвета</h3>
        </div>
        <Field label="Заголовки">
          <Select value={theme.fontHeading} onChange={(e) => setTheme({ ...theme, fontHeading: e.target.value })}>
            <optgroup label="Встроенные">
              {FONT_FAMILIES.map((f) => (
                <option key={f} value={f}>
                  {FONT_LABELS[f]}
                </option>
              ))}
            </optgroup>
            {ownFonts.length > 0 && (
              <optgroup label="Свои">
                {ownFonts.map((f) => (
                  <option key={f.id} value={f.family}>
                    {f.family}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </Field>
        <div className="mt-2">
          <Field label="Позиции и цены">
            <Select value={theme.fontBody} onChange={(e) => setTheme({ ...theme, fontBody: e.target.value })}>
              <optgroup label="Встроенные">
                {FONT_FAMILIES.map((f) => (
                  <option key={f} value={f}>
                    {FONT_LABELS[f]}
                  </option>
                ))}
              </optgroup>
              {ownFonts.length > 0 && (
                <optgroup label="Свои">
                  {ownFonts.map((f) => (
                    <option key={f.id} value={f.family}>
                      {f.family}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
          </Field>
        </div>

        <div className="mt-2 rounded-lg border border-line p-2">
          <p className="text-[11.5px] text-ink-secondary">Свой шрифт</p>
          <p className="mt-0.5 text-[10.5px] text-ink-tertiary">TTF, OTF, WOFF или WOFF2 с кириллицей и знаком ₽. До 8 МБ.</p>
          <label className={cx('mt-1.5 inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-lg border border-line px-2 text-[12px] font-semibold text-brand', fontBusy && 'opacity-50')}>
            {fontBusy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Загрузить
            <input
              type="file"
              accept=".ttf,.otf,.woff,.woff2"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void uploadFont(f, null)
                e.target.value = ''
              }}
            />
          </label>
          {ownFonts.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {ownFonts.map((f) => (
                <li key={f.id} className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate text-[12px]" style={{ fontFamily: `"${f.family}", sans-serif` }}>
                    {f.family}
                  </span>
                  <button
                    type="button"
                    onClick={() => void removeFont(f.id)}
                    className="grid h-6 w-6 place-items-center rounded text-ink-tertiary hover:text-bad"
                    aria-label={`Удалить шрифт ${f.family}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {(
          [
            ['bg', 'Фон листа', undefined],
            ['text', 'Текст', theme.bg],
            ['accent', 'Акцент', theme.bg],
          ] as const
        ).map(([key, label, pair]) => (
          <ColorField
            key={key}
            label={label}
            value={theme[key]}
            contrastWith={pair}
            swatches={BRAND_COLORS}
            onChange={(next) => applyThemeColor(key, next)}
          />
        ))}
        <div className="mt-2 flex flex-wrap gap-1">
          {theme.recentColors && theme.recentColors.length > 0 && (
            <p className="w-full text-[10.5px] uppercase tracking-wide text-ink-tertiary">недавние</p>
          )}
          {(theme.recentColors ?? []).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => applyThemeColor('accent', c)}
              aria-label={`Недавний цвет ${c}`}
              title={c}
              style={{ background: c }}
              className="h-5 w-5 rounded-full border border-line"
            />
          ))}
        </div>
      </section>

      <section className="border-b border-line px-3 py-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold">Градиент фона</h3>
          <label className="flex items-center gap-1.5 text-[12px] text-ink-secondary">
            <input
              type="checkbox"
              checked={!!theme.gradient}
              onChange={(e) =>
                setTheme({ ...theme, gradient: e.target.checked ? { from: theme.bg, to: '#FFFFFF', angle: 135 } : null })
              }
            />
            включить
          </label>
        </div>
        {theme.gradient && (
          <>
            <ColorField
              label="От"
              value={theme.gradient.from}
              onChange={(next) => setTheme({ ...theme, gradient: { ...theme.gradient!, from: next } })}
            />
            <ColorField
              label="До"
              value={theme.gradient.to}
              onChange={(next) => setTheme({ ...theme, gradient: { ...theme.gradient!, to: next } })}
            />
            <label className="mt-2 block text-[12px] text-ink-secondary">
              Угол {theme.gradient.angle}°
              <input
                type="range"
                min={0}
                max={360}
                step={15}
                value={theme.gradient.angle}
                onChange={(e) => setTheme({ ...theme, gradient: { ...theme.gradient!, angle: Number(e.target.value) } })}
                className="mt-1 w-full"
                aria-label="Угол градиента"
              />
            </label>
            <p className="mt-1 text-[10.5px] text-ink-tertiary">Печатается в PDF так же, как на холсте.</p>
          </>
        )}
      </section>

      <section className="border-b border-line px-3 py-3">
        <h3 className="mb-2 text-[13px] font-semibold">Палитры бренда</h3>
        {palettes.length === 0 && (
          <p className="text-[11.5px] text-ink-tertiary">
            Пока нет сохранённых палитр. Настройте цвета выше и сохраните — они будут доступны во всех макетах.
          </p>
        )}
        <ul className="space-y-1">
          {palettes.map((p) => (
            <li key={p.id} className="flex items-center gap-1 rounded-lg border border-line px-1.5 py-1">
              <button
                type="button"
                onClick={() => applyPalette(p.colors)}
                className="min-w-0 flex-1 truncate text-left text-[12.5px] hover:text-brand"
                title="Применить палитру: фон, текст, акцент"
              >
                {p.name}
              </button>
              <span className="flex flex-none gap-0.5">
                {p.colors.slice(0, 4).map((c) => (
                  <i key={c} className="h-4 w-4 rounded border border-line" style={{ background: c }} />
                ))}
              </span>
              <button
                type="button"
                onClick={() => void removePalette(p.id)}
                className="grid h-6 w-6 flex-none place-items-center rounded text-ink-tertiary hover:text-bad"
                aria-label={`Удалить палитру ${p.name}`}
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-1">
          <Input
            value={paletteName}
            onChange={(e) => setPaletteName(e.target.value)}
            placeholder="Название палитры"
            aria-label="Название новой палитры"
            className="!h-8 text-[12px]"
          />
          <Button size="sm" variant="secondary" onClick={() => void savePalette()}>
            Сохранить
          </Button>
        </div>
      </section>

      <section className="border-b border-line px-3 py-3">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-[13px] font-semibold">Фон листа</h3>
          <span className="text-[11px] text-ink-tertiary">картинка</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-lg border border-line px-2 text-[12px] font-semibold text-brand">
            <Upload size={13} /> Загрузить
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void uploadInto(f, (url) => setTheme({ ...theme, backgroundImageUrl: url }))
                e.target.value = ''
              }}
            />
          </label>
          <span className="text-[11px] text-ink-tertiary">или</span>
          <Input
            value={theme.backgroundImageUrl ?? ''}
            placeholder="https://…"
            onChange={(e) => setTheme({ ...theme, backgroundImageUrl: e.target.value.trim() || null })}
            className="!h-8 flex-1 text-[12px]"
          />
          {theme.backgroundImageUrl && (
            <button type="button" onClick={() => setTheme({ ...theme, backgroundImageUrl: null })} className="text-ink-tertiary hover:text-bad" aria-label="Убрать фон">
              <X size={14} />
            </button>
          )}
        </div>
        {theme.backgroundImageUrl && (
          <label className="mt-2 block text-[12px] text-ink-secondary">
            Затемнение · {theme.backgroundDim}%
            <input
              type="range"
              min={0}
              max={80}
              value={theme.backgroundDim}
              onChange={(e) => setTheme({ ...theme, backgroundDim: Number(e.target.value) })}
              className="mt-1 w-full"
            />
          </label>
        )}
      </section>

      <section className="px-3 py-3">
        <h3 className="mb-2 text-[13px] font-semibold">Логотип в подвале</h3>
        <Field label="Где рисовать 6.7">
          <Select value={theme.logoPosition} onChange={(e) => setTheme({ ...theme, logoPosition: e.target.value as MenuTheme['logoPosition'] })}>
            <option value="left">Не в подвале</option>
            <option value="footer">В подвале</option>
          </Select>
        </Field>
      </section>
    </div>
  )

  const blockPane = selected ? (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex items-start gap-2 border-b border-line px-3 py-3">
        {selected.displayImageUrl ? (
          <img src={selected.displayImageUrl} alt="" className="h-12 w-12 rounded-lg object-cover" />
        ) : (
          <span className="grid h-12 w-12 place-items-center rounded-lg bg-surface-2 text-ink-tertiary">
            <Type size={16} aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-ink-tertiary">{selectedType === 'product' ? 'Позиция' : 'Блок'}</p>
          <p className="truncate text-[13px] font-semibold text-ink">{layerName(selected)}</p>
          <p className="truncate text-[11px] text-ink-tertiary">
            {selected.productId
              ? [selected.displayCategory ?? 'Каталог 6.7', selected.displaySizes && selected.displaySizes.length > 1
                  ? `${selected.displaySizes.length} объёма`
                  : selected.product?.variantLabel ?? null]
                  .filter(Boolean)
                  .join(' · ')
              : `слой ${selected.zIndex}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => toggleLock(selected.id)}
          className={cx('grid h-7 w-7 shrink-0 place-items-center rounded-md', selected.locked ? 'bg-surface-2 text-brand' : 'text-ink-tertiary hover:text-brand')}
          aria-pressed={!!selected.locked}
          aria-label={selected.locked ? 'Снять замок' : 'Закрепить блок'}
          title={selected.locked ? 'Снять замок' : 'Закрепить блок'}
        >
          {selected.locked ? <Lock size={14} /> : <LockOpen size={14} />}
        </button>
      </div>

      <section className="border-b border-line px-3 py-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold">Положение и размер</h3>
          <div className="flex gap-1 rounded-md bg-surface-2 p-0.5">
            {(sheetMm(format) ? (['pct', 'mm'] as const) : (['pct'] as const)).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setUnit(u)}
                aria-pressed={unit === u}
                className={cx('rounded px-1.5 py-0.5 text-[10.5px] font-semibold', unit === u ? 'bg-white text-brand shadow-sm' : 'text-ink-tertiary')}
              >
                {u === 'pct' ? '%' : 'мм'}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(unit === 'pct'
            ? ([
                ['xPct', 'X, %'],
                ['yPct', 'Y, %'],
                ['wPct', 'Ширина, %'],
                ['hPct', 'Высота, %'],
              ] as [string, string][])
            : ([
                ['x', 'X, мм'],
                ['y', 'Y, мм'],
                ['w', 'Ширина, мм'],
                ['h', 'Высота, мм'],
              ] as [string, string][])
          ).map(([key, label]) => (
            <Field key={key} label={label}>
              <Input
                type="number"
                step={unit === 'pct' ? '0.5' : '1'}
                min={0}
                max={unit === 'pct' ? 100 : Math.round(sheetMm(format)?.width ?? 100)}
                value={
                  unit === 'pct'
                    ? Math.round(Number((selected as unknown as Record<string, number>)[key]) * 10) / 10
                    : Number((pctToMm(selected, format) as unknown as Record<string, number>)[key])
                }
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (!Number.isFinite(v)) return
                  const mmRect = pctToMm(selected, format)
                  if (unit === 'pct' || !mmRect) {
                    patchBlock(clampRect({ ...selected, [key]: v }))
                    return
                  }
                  const next = mmToPct({ ...mmRect, [key]: v }, format)
                  if (next) patchBlock({ ...selected, ...clampRect({ ...selected, ...next }) })
                }}
                className="!h-8 text-[12px]"
              />
            </Field>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-ink-tertiary">
          {unit === 'mm' && sheetMm(format)
            ? `Лист ${sheetMm(format)!.width} × ${sheetMm(format)!.height} мм, поля 4,4 % по бокам и сверху и 6 % снизу. Значения — от края листа.`
            : `Минимум ${MIN_W}×${MIN_H} %. Стрелки двигают на 0,5 %, с Shift — на 5 %.`}
        </p>
        <PhotoDpiHint
          url={selected.displayImageUrl ?? selected.url ?? null}
          widthPct={selected.wPct}
          ratio={LAYOUT_FORMATS.find((f) => f.id === format)?.ratio ?? 210 / 297}
        />
      </section>

      <section className="border-b border-line px-3 py-3">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-[13px] font-semibold">Стиль блока</h3>
          {boundStyle && <span className="text-[11px] text-ink-tertiary">следует за стилем</span>}
        </div>
        <Field label="Стиль">
          <Select
            value={boundStyle?.id ?? ''}
            onChange={(e) => (e.target.value ? bindSelectedToStyle(e.target.value) : detachSelectedFromStyle())}
            aria-label="Стиль блока"
          >
            <option value="">Индивидуальный</option>
            {styles.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.fontSizePt} pt{doc ? ` · ${styleUsage(doc, s.id)} бл.` : ''}
              </option>
            ))}
          </Select>
        </Field>
        {boundStyle ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button size="sm" variant="secondary" onClick={refreshStyleFromBlock}>
              Обновить стиль по блоку
            </Button>
            <Button size="sm" variant="secondary" onClick={detachSelectedFromStyle}>
              Отвязать
            </Button>
          </div>
        ) : (
          <div className="mt-2 flex items-end gap-1.5">
            <div className="min-w-0 flex-1">
              <Field label="Новый стиль">
                <Input
                  value={newStyleName}
                  onChange={(e) => setNewStyleName(e.target.value)}
                  placeholder="Например, «Название»"
                  maxLength={40}
                  aria-label="Имя нового стиля"
                  className="!h-8 text-[12px]"
                />
              </Field>
            </div>
            <Button size="sm" onClick={createStyleFromBlock}>
              Создать
            </Button>
          </div>
        )}
        <p className="mt-1.5 text-[11px] text-ink-tertiary">
          Стиль хранит кегль, жирность, выравнивание, интерлиньяж, трекинг и капс. Правка этих полей у привязанного
          блока меняет все блоки стиля.
        </p>
      </section>

      <section className="border-b border-line px-3 py-3">
        <h3 className="mb-2 text-[13px] font-semibold">Содержимое</h3>
        {(selectedType === 'product' || selectedType === 'category') && (
          <Field label="Название в макете">
            <Input
              value={selected.titleOverride ?? ''}
              placeholder={selected.displayName ?? 'Как в каталоге'}
              onChange={(e) => patchBlock({ titleOverride: e.target.value || null })}
            />
          </Field>
        )}
        {selectedType === 'product' && (
          <>
            <div className="mt-2">
              <Field label="Цена в макете" hint="Пусто — из каталога. Можно «169 / 269».">
                <Input
                  value={selected.priceText ?? ''}
                  placeholder={selected.product?.priceRub != null ? String(selected.product.priceRub) : '169 / 269'}
                  onChange={(e) => {
                    const v = e.target.value.trim()
                    patchBlock({ priceText: v || null, priceRubOverride: /^\d+$/.test(v) ? Number(v) : null })
                  }}
                />
              </Field>
            </div>
            <label className="mt-2 flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={!!selected.uppercase} onChange={(e) => patchBlock({ uppercase: e.target.checked })} />
              Название капсом
            </label>
            <div className="mt-2">
              <Field label="Интерлиньяж" hint={(selected.lineHeight ?? 1.15).toFixed(2)}>
                <input
                  type="range"
                  min={0.9}
                  max={1.8}
                  step={0.05}
                  value={selected.lineHeight ?? 1.15}
                  onChange={(e) => patchBlock({ lineHeight: Number(e.target.value) })}
                  className="w-full"
                  aria-label="Интерлиньяж позиции"
                />
              </Field>
            </div>
            <div className="mt-2">
              <Field label="Трекинг" hint={`${selected.tracking ?? 0}`}>
                <input
                  type="range"
                  min={-50}
                  max={200}
                  step={5}
                  value={selected.tracking ?? 0}
                  onChange={(e) => patchBlock({ tracking: Number(e.target.value) })}
                  className="w-full"
                  aria-label="Трекинг позиции"
                />
              </Field>
            </div>
            <Button size="sm" variant="secondary" className="mt-2 w-full" onClick={() => autofitText(selected.id)}>
              Вписать название в блок
            </Button>
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
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[12px] text-ink-secondary">Своё фото позиции</span>
              <label className={cx('inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-lg border border-line px-2 text-[12px] font-semibold text-brand', busyUpload && 'opacity-50')}>
                {busyUpload ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Загрузить
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    // В макет берём полный размер (960), иначе на печати картинка мыльная.
                    if (f) void uploadInto(f, (url) => patchBlock({ photoUrlOverride: url, showPhoto: true }), true)
                    e.target.value = ''
                  }}
                />
              </label>
            </div>
            <Input
              value={selected.photoUrlOverride ?? ''}
              placeholder="/uploads/… или загрузите файл"
              onChange={(e) => setImageUrl(e.target.value, 'photoUrlOverride')}
              className="mt-1.5 !h-8 text-[12px]"
            />
            <label className="mt-2 flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={selected.showPhoto} onChange={(e) => patchBlock({ showPhoto: e.target.checked })} />
              Показывать фото в блоке
            </label>
            {selected.showPhoto && cropControls(selected)}
          </>
        )}

        {selectedType === 'text' && (
          <>
            <Field label="Текст">
              <textarea
                value={selected.text ?? ''}
                onChange={(e) => patchBlock({ text: e.target.value })}
                rows={3}
                className="w-full rounded-lg border border-line px-2 py-1.5 text-[13px] outline-none focus:border-brand"
              />
            </Field>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label="Кегль, pt">
                <Input
                  type="number"
                  min={5}
                  max={72}
                  value={selected.fontSizePt}
                  onChange={(e) => patchBlock({ fontSizePt: Number(e.target.value) || 10 })}
                  className="!h-8 text-[12px]"
                />
              </Field>
              <Field label="Выравнивание">
                <Select value={selected.align} onChange={(e) => patchBlock({ align: e.target.value as MenuBlock['align'] })}>
                  <option value="left">Слева</option>
                  <option value="center">По центру</option>
                  <option value="right">Справа</option>
                </Select>
              </Field>
            </div>
            <label className="mt-2 flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={selected.bold} onChange={(e) => patchBlock({ bold: e.target.checked })} />
              Жирный (Unbounded)
            </label>
            <label className="mt-1 flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={!!selected.uppercase} onChange={(e) => patchBlock({ uppercase: e.target.checked })} />
              Капсом (заглавными)
            </label>
            <div className="mt-2">
              <Field label="Интерлиньяж" hint={`${(selected.lineHeight ?? 1.15).toFixed(2)} — расстояние между строками`}>
                <input
                  type="range"
                  min={0.9}
                  max={1.8}
                  step={0.05}
                  value={selected.lineHeight ?? 1.15}
                  onChange={(e) => patchBlock({ lineHeight: Number(e.target.value) })}
                  className="w-full"
                  aria-label="Интерлиньяж"
                />
              </Field>
            </div>
            <div className="mt-2">
              <Field label="Трекинг" hint={`${selected.tracking ?? 0} — разрежение букв, −50…+200`}>
                <input
                  type="range"
                  min={-50}
                  max={200}
                  step={5}
                  value={selected.tracking ?? 0}
                  onChange={(e) => patchBlock({ tracking: Number(e.target.value) })}
                  className="w-full"
                  aria-label="Трекинг"
                />
              </Field>
            </div>
            <Button size="sm" variant="secondary" className="mt-2 w-full" onClick={() => autofitText(selected.id)}>
              Вписать текст в блок
            </Button>
          </>
        )}

        {selectedType === 'image' && (
          <>
            <div className="flex items-center gap-2">
              <label className={cx('inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-lg border border-line px-2 text-[12px] font-semibold text-brand', busyUpload && 'opacity-50')}>
                {busyUpload ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Загрузить
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void uploadInto(f, (url) => patchBlock({ url }), true)
                    e.target.value = ''
                  }}
                />
              </label>
              <span className="text-[11px] text-ink-tertiary">или ссылка</span>
            </div>
            <Input
              value={selected.url ?? ''}
              placeholder="/uploads/… или загрузите файл"
              onChange={(e) => setImageUrl(e.target.value, 'url')}
              className="mt-1.5 !h-8 text-[12px]"
            />
            <div className="mt-2">
              <Field label="Вписывание">
                <Select value={selected.fit} onChange={(e) => patchBlock({ fit: e.target.value as MenuBlock['fit'] })}>
                  <option value="cover">Заполнить (обрезать)</option>
                  <option value="contain">Вписать целиком</option>
                </Select>
              </Field>
            </div>
            {cropControls(selected)}
            <div className="mt-2">
              <Field label="Подпись (для скринридера)">
                <Input value={selected.titleOverride ?? ''} onChange={(e) => patchBlock({ titleOverride: e.target.value || null })} className="!h-8 text-[12px]" />
              </Field>
            </div>
          </>
        )}

        {selectedType === 'logo' && (
          <Field label="Подпись справа (например, сезон)">
            <Input value={selected.text ?? ''} onChange={(e) => patchBlock({ text: e.target.value || null })} placeholder="весна / лето 2026" />
          </Field>
        )}

        {selectedType === 'divider' && <p className="text-[12px] text-ink-secondary">Линия-разделитель. Меняйте ширину и положение выше.</p>}

        <p className="mt-2 text-[11px] leading-4 text-ink-tertiary">
          Данные из каталога. Правки здесь меняют только макет — не кассу и не карточку товара.
        </p>
      </section>

      <section className="px-3 py-3">
        <h3 className="mb-2 text-[13px] font-semibold">Действия</h3>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon={<Layers size={14} />} onClick={() => updatePage((bs) => bringToFront(bs, selected.id))}>
            На передний
          </Button>
          <Button size="sm" variant="secondary" icon={<Layers size={14} />} onClick={() => updatePage((bs) => sendToBack(bs, selected.id))}>
            На задний
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={selected.hidden ? <Eye size={14} /> : <EyeOff size={14} />}
            onClick={() => updatePage((bs) => toggleHidden(bs, selected.id))}
          >
            {selected.hidden ? 'Показать' : 'Скрыть'}
          </Button>
          <Button size="sm" variant="secondary" icon={<Trash2 size={14} />} onClick={() => deleteBlock(selected.id)}>
            Удалить блок
          </Button>
        </div>
      </section>
    </div>
  ) : (
    <div className="p-3 text-[13px] text-ink-secondary">
      Выберите блок на холсте или в списке слоёв — здесь появятся его координаты и свойства.
    </div>
  )

  /** Левая панель: на широком экране стоит в сетке, на среднем — в шторке. */
  const leftAside = (
    <aside className="flex h-full max-h-[calc(100vh-230px)] min-h-[320px] flex-col overflow-hidden rounded-xl border border-line bg-white">
      <div className="flex border-b border-line">
        {(
          [
            ['catalog', 'Каталог'],
            ...((data?.layout.sections ?? 0) > 0 ? ([['places', 'Места']] as [LeftTab, string][]) : []),
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
      {leftTab === 'catalog' ? catalogPane : leftTab === 'places' ? placesPane : layersPane}
    </aside>
  )

  return (
    <div ref={attachRoot}>
      {/* Клавиатура: Tab по панелям длинный, поэтому лист доступен сразу. */}
      <button
        type="button"
        onClick={() => sheetRef.current?.focus()}
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[90] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-[13px] focus:font-semibold focus:text-brand focus:shadow-soft"
      >
        Перейти к листу
      </button>
      {/* ── тулбар ─────────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link
          to="/menu-layouts"
          className="inline-flex min-h-9 items-center gap-1 rounded-lg px-1.5 text-[13px] font-semibold text-brand hover:bg-surface-2"
        >
          <ArrowLeft size={16} /> Все макеты
        </Link>
        <div className={cx('min-w-0', mode === 'wide' ? 'flex-1' : 'w-full')}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              aria-label="Название макета"
              className="min-w-[7rem] flex-1 truncate border-0 bg-transparent p-0 text-[19px] font-bold text-ink outline-none focus:underline"
            />
            <span
              className={cx(
                // Статус не должен наезжать на кнопки: он сжимается и уходит на свою строку.
                'inline-flex min-w-0 items-center gap-1 truncate text-[11px] font-semibold',
                save === 'error' ? 'text-bad' : save === 'dirty' || save === 'saving' ? 'text-ink-tertiary' : 'text-ok',
              )}
              aria-live="polite"
            >
              {save === 'saving' ? <Loader2 size={12} className="animate-spin" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
              {statusLabel} · {saveStateText}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[12px] text-ink-secondary">
            {formatFull(format)} · {doc.pages.length} стр. ·{' '}
            {priceMode === 'frozen' ? `цены зафиксированы${fmtFrozen(frozenAt)}` : 'цены из каталога'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="secondary" icon={<Undo2 size={14} />} onClick={undo} disabled={!canUndo(history)}>
            Отменить
          </Button>
          <Button size="sm" variant="secondary" icon={<Redo2 size={14} />} onClick={redo} disabled={!canRedo(history)}>
            Вернуть
          </Button>
          <Button size="sm" variant="secondary" icon={<Eye size={14} />} onClick={() => setPreviewOpen(true)}>
            Предпросмотр
          </Button>
          <Button size="sm" variant="secondary" icon={<History size={14} />} onClick={() => setVersionsOpen(true)}>
            Версии
          </Button>
          <Button size="sm" icon={<Download size={14} />} onClick={() => setExportOpen(true)}>
            Экспорт PDF
          </Button>
        </div>
      </div>

      {onboardingHidden ? (
        <p className="mb-3 flex items-start gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-[12.5px] leading-4 text-ink-secondary">
          <Layers size={14} className="mt-0.5 flex-none text-brand" aria-hidden />
          Перетащите позицию на листе, тяните угол — блок меняет размер; края прилипают к полям и соседям
          (Alt — без прилипания). ⌘K — все команды.
        </p>
      ) : (
        <div className="mb-3 rounded-xl border border-brand/30 bg-brand/5 px-3 py-2.5" data-testid="onboarding">
          <div className="mb-1.5 flex items-center gap-2">
            <Sparkles size={14} className="flex-none text-brand" aria-hidden />
            <span className="min-w-0 flex-1 text-[12.5px] font-semibold text-ink">Три шага до готового макета</span>
            <button
              type="button"
              onClick={() => {
                setOnboardingHidden(true)
                try {
                  localStorage.setItem('menu-layout-onboarding', 'done')
                } catch {
                  /* приватный режим */
                }
              }}
              className="text-[12px] font-semibold text-brand underline"
            >
              Понятно
            </button>
          </div>
          <ol className="ml-4 list-decimal space-y-0.5 text-[12px] leading-4 text-ink-secondary">
            <li>«Собрать из каталога» — лист заполнится товарами с ценами.</li>
            <li>Перетащите блоки, тяните угол для размера; края прилипают к полям.</li>
            <li>«Экспорт PDF» — файл с полями под рез. ⌘K открывает все команды.</li>
          </ol>
        </div>
      )}

      {driftText && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-warn/40 bg-warn-soft px-3 py-2 text-[13px] text-warn">
          <RefreshCw size={15} className="flex-none" aria-hidden />
          <span className="min-w-0 flex-1">{driftText}</span>
          <Button size="sm" variant="secondary" onClick={() => void syncPrices()}>
            {priceMode === 'frozen' ? 'Проверить' : 'Обновить с каталога'}
          </Button>
        </div>
      )}

      {MENU_LAYOUT_V2 && (
        <div className="mb-3 rounded-xl border border-line bg-surface-2 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles size={15} className="flex-none text-brand" aria-hidden />
            <input
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void runAi()}
              placeholder="Опишите правку: «добавь напитки», «убери корицу», «переименуй добавки в топпинги»"
              aria-label="Запрос к AI"
              className="min-h-9 min-w-0 flex-1 rounded-lg border border-line bg-white px-2 text-[13px] outline-none"
            />
            <Button size="sm" variant="secondary" loading={aiBusy} onClick={() => void runAi()}>
              Предложить
            </Button>
          </div>
          {aiPlan && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px]">
              <span className="min-w-0 flex-1">
                {aiPlan.summary} · операций: {aiPlan.ops.length}. Запишем только после подтверждения.
              </span>
              <Button size="sm" onClick={() => void applyAiPlan()} loading={aiBusy}>
                Применить
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setAiPlan(null)} disabled={aiBusy}>
                Отмена
              </Button>
            </div>
          )}
        </div>
      )}

      {draftOffer && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-warn/40 bg-warn-soft px-3 py-2 text-[13px] text-warn">
          <span className="min-w-0 flex-1">
            Найден несохранённый черновик от {new Date(draftOffer.savedAt).toLocaleString('ru-RU')} — он новее
            сохранённой версии. Восстановить?
          </span>
          <Button size="sm" onClick={restoreDraft}>
            Восстановить
          </Button>
          <Button size="sm" variant="secondary" onClick={dropDraft}>
            Выбросить
          </Button>
        </div>
      )}

      {conflict && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-bad/40 bg-bad-soft px-3 py-2 text-[13px] text-bad">
          <RefreshCw size={15} className="flex-none" aria-hidden />
          <span className="min-w-0 flex-1">
            Макет изменили в другом окне. Ваши правки ещё не сохранены — выберите, чью версию оставить.
          </span>
          <Button size="sm" variant="secondary" onClick={takeServerVersion}>
            Взять серверную
          </Button>
          <Button size="sm" onClick={() => void overwriteMine()}>
            Перезаписать своей
          </Button>
        </div>
      )}

      {blockers.length > 0 && (
        <div className="mb-3 rounded-xl border border-warn/40 bg-warn-soft px-3 py-2">
          <p className="text-[13px] font-semibold text-warn">Перед печатью: {blockers.length}</p>
          <ul className="mt-1 space-y-0.5">
            {blockers.slice(0, 8).map((b) => (
              <li key={`${b.blockId}-${b.text}`}>
                <button
                  type="button"
                  onClick={() => goToBlock(b.blockId, b.pageIdx)}
                  className="text-left text-[12.5px] text-ink-secondary hover:text-brand hover:underline"
                >
                  {b.label} — {b.text}
                </button>
              </li>
            ))}
          </ul>
          {blockers.length > 8 && <p className="mt-1 text-[12px] text-ink-tertiary">и ещё {blockers.length - 8}</p>}
        </div>
      )}

      {/* ── мобильные вкладки ─────────────────────────────── */}
      <nav
        className={cx(
          'mb-3 gap-1 rounded-xl border border-line bg-surface-2 p-1',
          mode === 'narrow' ? 'flex' : 'hidden',
        )}
        aria-label="Разделы редактора"
      >
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

      {/* ── десктоп и планшет: две-три зоны ───────────────── */}
      <div
        className={cx('gap-3', mode === 'narrow' ? 'hidden' : 'grid')}
        style={{
          // На средней ширине левая панель живёт в шторке — лист получает её место.
          gridTemplateColumns:
            mode === 'wide'
              ? 'minmax(220px, 260px) minmax(0, 1fr) minmax(250px, 300px)'
              : 'minmax(0, 1fr) minmax(238px, 290px)',
        }}
      >
        {mode === 'wide' && leftAside}

        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white px-2 py-1.5">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-secondary">
              {mode === 'medium' && (
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  className="inline-flex h-8 flex-none items-center gap-1 rounded-md border border-line px-2 text-[12px] font-semibold text-ink-secondary hover:border-brand hover:text-brand"
                  aria-label="Открыть каталог и слои"
                >
                  <ListTree size={14} aria-hidden /> Состав
                </button>
              )}
              <span className="rounded-md bg-surface-2 px-2 py-1">
                {data?.layout.formatHint.label} · {formatSize(format)}
              </span>
              <Badge tone={status === 'ready' ? 'ok' : 'neutral'}>{status === 'ready' ? 'Готов' : 'Черновик'}</Badge>
              <span className="text-[11px] font-normal text-ink-tertiary">{page.blocks.length} блоков</span>
            </div>
            <div
              className={cx(
                'flex min-w-0 basis-full items-center gap-1 sm:basis-auto',
                // На планшете кнопок много: держим одну строку с прокруткой, чтобы
                // панель не занимала пол-экрана по высоте.
                mode === 'wide' ? 'flex-wrap justify-end' : 'mc-toolbar-scroll flex-nowrap justify-start',
              )}
            >
              {selectedIds.length > 0 && editableIds.length <= 1 && (
                <>
                  <button type="button" onClick={takeStyle} className="h-8 rounded-md px-2 text-[11px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-brand" title="Скопировать стиль блока">
                    стиль ↓
                  </button>
                  <button type="button" onClick={applyStyle} className="h-8 rounded-md px-2 text-[11px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-brand" title="Применить стиль к выделенным">
                    стиль ↑
                  </button>
                  <span className="mx-1 h-5 w-px bg-line" />
                </>
              )}
              {editableIds.length > 1 && (
                <>
                  <span className="mr-1 text-[11px] font-semibold text-ink-tertiary">выбрано {selectedIds.length}</span>
                  {(
                    [
                      ['left', AlignStartVertical, 'По левому краю'],
                      ['center', AlignCenterVertical, 'По центру'],
                      ['right', AlignEndVertical, 'По правому краю'],
                      ['top', AlignStartHorizontal, 'По верхнему краю'],
                      ['middle', AlignCenterHorizontal, 'По середине'],
                      ['bottom', AlignEndHorizontal, 'По нижнему краю'],
                    ] as const
                  ).map(([mode, Icon, title]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => align(mode)}
                      className="grid h-8 w-8 place-items-center rounded-md text-ink-tertiary hover:bg-surface-2 hover:text-brand"
                      aria-label={title}
                      title={title}
                    >
                      <Icon size={15} />
                    </button>
                  ))}
                  <button type="button" onClick={() => distribute('x')} className="h-8 rounded-md px-2 text-[11px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-brand" title="Равные промежутки по горизонтали">
                    ⇿
                  </button>
                  <button type="button" onClick={() => distribute('y')} className="h-8 rounded-md px-2 text-[11px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-brand" title="Равные промежутки по вертикали">
                    ⇅
                  </button>
                  <span className="mx-1 h-5 w-px bg-line" />
                  <button type="button" onClick={() => columns(1)} className="h-8 rounded-md px-2 text-[11px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-brand" title="Разложить в одну колонку">
                    1 кол.
                  </button>
                  <button type="button" onClick={() => columns(2)} className="h-8 rounded-md px-2 text-[11px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-brand" title="Разложить в две колонки">
                    2 кол.
                  </button>
                  <button type="button" onClick={() => columns(3)} className="h-8 rounded-md px-2 text-[11px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-brand" title="Разложить в три колонки">
                    3 кол.
                  </button>
                  <span className="mx-1 h-5 w-px bg-line" />
                  <button type="button" onClick={groupSelection} className="h-8 rounded-md px-2 text-[11px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-brand" title="Сгруппировать выделенные блоки">
                    группа
                  </button>
                  <button type="button" onClick={ungroupSelection} className="h-8 rounded-md px-2 text-[11px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-brand" title="Разгруппировать">
                    разбить
                  </button>
                  <button type="button" onClick={() => sameSize('w')} className="h-8 rounded-md px-2 text-[11px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-brand" title="Одинаковая ширина по опорному блоку">
                    = шир.
                  </button>
                  <button type="button" onClick={() => sameSize('h')} className="h-8 rounded-md px-2 text-[11px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-brand" title="Одинаковая высота по опорному блоку">
                    = выс.
                  </button>
                  <span className="mx-1 h-5 w-px bg-line" />
                  <button type="button" onClick={() => bulkFontSize(-0.5)} className="h-8 w-8 rounded-md text-[12px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-brand" title="Уменьшить кегль всех выделенных на 0,5 pt" aria-label="Уменьшить кегль выделенных">
                    A−
                  </button>
                  <button type="button" onClick={() => bulkFontSize(0.5)} className="h-8 w-8 rounded-md text-[12px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-brand" title="Увеличить кегль всех выделенных на 0,5 pt" aria-label="Увеличить кегль выделенных">
                    A+
                  </button>
                  <select
                    value=""
                    onChange={(e) => e.target.value && bulkFamily(e.target.value)}
                    aria-label="Семейство шрифта для всех выделенных"
                    title="Семейство шрифта для всех выделенных"
                    className="h-8 rounded-md border border-line bg-white px-1 text-[11px] text-ink-secondary"
                  >
                    <option value="">шрифт…</option>
                    {FONT_FAMILIES.map((f) => (
                      <option key={f} value={f}>
                        {FONT_LABELS[f]}
                      </option>
                    ))}
                  </select>
                  <span className="mx-1 h-5 w-px bg-line" />
                  <button type="button" onClick={takeStyle} className="h-8 rounded-md px-2 text-[11px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-brand" title="Скопировать стиль с активного блока">
                    стиль ↓
                  </button>
                  <button type="button" onClick={applyStyle} className="h-8 rounded-md px-2 text-[11px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-brand" title="Применить скопированный стиль к выделенным">
                    стиль ↑
                  </button>
                  <span className="mx-1 h-5 w-px bg-line" />
                </>
              )}
              <button
                type="button"
                onClick={() => setShowGrid((v) => !v)}
                aria-pressed={showGrid}
                className={cx('grid h-8 w-8 place-items-center rounded-md', showGrid ? 'bg-surface-2 text-brand' : 'text-ink-tertiary hover:text-brand')}
                title="Сетка"
                aria-label={showGrid ? 'Выключить сетку и привязку' : 'Включить сетку и привязку'}
              >
                <Grid3x3 size={15} />
              </button>
              {showGrid && (
                <span className="flex items-center gap-1 rounded-md bg-surface-2 px-1">
                  <select
                    value={gridStep}
                    onChange={(e) => setGridStep(Number(e.target.value))}
                    aria-label="Шаг сетки"
                    title="Шаг сетки, % листа"
                    className="h-7 rounded bg-transparent text-[11px] text-ink-secondary outline-none"
                  >
                    {[2.5, 5, 10, 12.5, 25].map((v) => (
                      <option key={v} value={v}>
                        {v} %
                      </option>
                    ))}
                  </select>
                  <select
                    value={gridCols}
                    onChange={(e) => setGridCols(Number(e.target.value))}
                    aria-label="Колонки сетки"
                    title="Колонки: направляющие для колонок меню"
                    className="h-7 rounded bg-transparent text-[11px] text-ink-secondary outline-none"
                  >
                    {[1, 2, 3, 4].map((v) => (
                      <option key={v} value={v}>
                        {v} кол.
                      </option>
                    ))}
                  </select>
                </span>
              )}
              <button
                type="button"
                onClick={() => setShowSafe((v) => !v)}
                aria-pressed={showSafe}
                className={cx('h-8 rounded-md px-2 text-[11px] font-semibold', showSafe ? 'bg-surface-2 text-brand' : 'text-ink-tertiary hover:text-brand')}
                title="Безопасная зона (поля)"
              >
                поля
              </button>
              <span className="mx-1 h-5 w-px bg-line" />
              <button type="button" onClick={() => setZoom((z) => zoomStep(z, -1))} className="grid h-8 w-8 place-items-center rounded-md text-ink-tertiary hover:text-brand" aria-label="Уменьшить" title="Уменьшить (Ctrl + колесо)">
                <Minus size={15} />
              </button>
              <button
                type="button"
                onClick={() => setZoom(1)}
                className="w-12 rounded-md text-center text-[11px] font-semibold tabular-nums text-ink-secondary hover:bg-surface-2"
                title="Сбросить масштаб до 100 %"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button type="button" onClick={() => setZoom((z) => zoomStep(z, 1))} className="grid h-8 w-8 place-items-center rounded-md text-ink-tertiary hover:text-brand" aria-label="Увеличить" title="Увеличить (Ctrl + колесо)">
                <Plus size={15} />
              </button>
              <button
                type="button"
                onClick={() => {
                  const box = canvasBox.current
                  if (!box) return
                  const ratio = LAYOUT_FORMATS.find((f) => f.id === format)?.ratio ?? 210 / 297
                  setZoom(fitZoom(box.clientWidth, box.clientHeight, ratio, 560))
                }}
                className="grid h-8 w-8 place-items-center rounded-md text-ink-tertiary hover:text-brand"
                aria-label="Вписать лист"
                title="Вписать лист целиком"
              >
                <Maximize2 size={15} />
              </button>
            </div>
          </div>

          <div
            ref={canvasBox}
            className={cx('flex-1 overflow-auto rounded-xl border border-line bg-[#e9ebef] p-4', spaceDown && 'cursor-grab')}
            onPointerDown={(e) => {
              // Пан: пробел + левая кнопка или средняя кнопка мыши.
              if (!(spaceDown || e.button === 1)) return
              const box = canvasBox.current
              if (!box) return
              e.preventDefault()
              const start = { x: e.clientX, y: e.clientY, left: box.scrollLeft, top: box.scrollTop }
              const move = (ev: PointerEvent) => {
                box.scrollLeft = start.left - (ev.clientX - start.x)
                box.scrollTop = start.top - (ev.clientY - start.y)
              }
              const up = () => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
              }
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', up)
            }}
            onWheel={(e) => {
              // Ctrl/⌘ + колесо — зум как в редакторах; обычное колесо листает.
              if (!e.ctrlKey && !e.metaKey) return
              e.preventDefault()
              setZoom((z) => clampZoom(z * (e.deltaY < 0 ? 1.1 : 0.9)))
            }}
          >
            <div
              ref={sheetRef}
              className="mx-auto rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              tabIndex={-1}
              aria-label="Лист макета"
              style={{
                width: `${Math.round(560 * zoom)}px`,
                // На планшете колонка уже 560 px: лист ужимается по ней, а не уезжает под панель.
                maxWidth: '100%',
                aspectRatio: String(LAYOUT_FORMATS.find((f) => f.id === format)?.ratio ?? 210 / 297),
              }}
              onPointerDown={(e) => {
                const target = e.target as HTMLElement
                const empty = target === e.currentTarget || !!target.closest('.mc-safe')
                if (target === e.currentTarget) {
                  setSelectedId(null)
                  setSelectedIds([])
                }
                // Рамка выделения: тянем по пустому месту безопасной области.
                if (!empty || (target !== e.currentTarget && target.closest('.mc-block'))) return
                const sheet = sheetRef.current
                if (!sheet) return
                const box = sheet.getBoundingClientRect()
                const off = safeBoxOffset(box)
                const size = safeBoxSize(box)
                const toPct = (clientX: number, clientY: number) => ({
                  x: ((clientX - box.left - off.left) / size.w) * 100,
                  y: ((clientY - box.top - off.top) / size.h) * 100,
                })
                const start = toPct(e.clientX, e.clientY)
                setMarquee(null)
                const move = (ev: PointerEvent) => {
                  const cur = toPct(ev.clientX, ev.clientY)
                  const rect = {
                    xPct: Math.max(0, Math.min(start.x, cur.x)),
                    yPct: Math.max(0, Math.min(start.y, cur.y)),
                    wPct: Math.abs(cur.x - start.x),
                    hPct: Math.abs(cur.y - start.y),
                  }
                  setMarquee(rect)
                  const hit = (page?.blocks ?? [])
                    .filter((b) => !b.hidden && rectsIntersect(rect, b))
                    .map((b) => b.id)
                  setSelectedIds(hit)
                  setSelectedId(hit[0] ?? null)
                }
                const up = () => {
                  setMarquee(null)
                  window.removeEventListener('pointermove', move)
                  window.removeEventListener('pointerup', up)
                }
                window.addEventListener('pointermove', move)
                window.addEventListener('pointerup', up)
              }}
            >
              <div className="h-full w-full shadow-[0_10px_30px_rgba(16,24,40,.15)]">{canvas({ interactive: true, grid: showGrid, safe: showSafe })}</div>
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
                  <button type="button" onClick={() => removePage(i)} className="ml-0.5 grid h-6 w-6 place-items-center rounded text-ink-tertiary hover:text-bad" aria-label={`Удалить страницу ${i + 1}`}>
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
              {savedAt ? `сохранено ${ago(savedAt)}` : 'автосохранение'} · ⌘Z отменяет, Delete убирает блок с листа
            </span>
          </div>
        </section>

        <aside className="flex max-h-[calc(100vh-230px)] min-h-[460px] flex-col overflow-hidden rounded-xl border border-line bg-white">
          <div className="flex border-b border-line">
            {(
              [
                ['design', 'Оформление'],
                ['block', 'Блок'],
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
          {rightTab === 'design' ? designPane : blockPane}
        </aside>
      </div>

      {/* ── планшет: каталог и слои в шторке ──────────────── */}
      {mode === 'medium' && drawerOpen && (
        <div
          className="fixed inset-0 z-[75] bg-black/40"
          onMouseDown={(e) => e.target === e.currentTarget && setDrawerOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Каталог и слои"
            className="absolute inset-y-0 left-0 flex w-[320px] max-w-[88vw] flex-col gap-2 bg-[#f6f8fb] p-2 shadow-2xl"
          >
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="ml-auto inline-flex h-8 items-center gap-1 rounded-md bg-white px-2 text-[12px] font-semibold text-ink-secondary hover:text-brand"
            >
              <X size={14} aria-hidden /> Закрыть
            </button>
            <div className="min-h-0 flex-1">{leftAside}</div>
          </div>
        </div>
      )}

      {/* ── мобильный режим ───────────────────────────────── */}
      <div className={mode === 'narrow' ? '' : 'hidden'}>
        {mobileTab === 'preview' && (
          <div className="rounded-xl border border-line bg-[#e9ebef] p-3">
            <div
              className="mx-auto max-w-[360px] shadow-[0_10px_30px_rgba(16,24,40,.15)]"
              style={{ aspectRatio: String(LAYOUT_FORMATS.find((f) => f.id === format)?.ratio ?? 210 / 297) }}
            >
              {canvas({ interactive: true, grid: showGrid, safe: showSafe })}
            </div>
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
            {selected && (
              <div className="mt-3 rounded-xl border border-line bg-white p-3">
                <p className="mb-2 text-[12px] font-semibold text-ink-secondary">
                  Блок: {layerName(selected)} · двигайте пальцем на листе
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ['xPct', 'X, %'],
                      ['yPct', 'Y, %'],
                      ['wPct', 'Ширина, %'],
                      ['hPct', 'Высота, %'],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="text-[11px] text-ink-tertiary">
                      {label}
                      <input
                        type="number"
                        step="0.5"
                        min={0}
                        max={100}
                        value={Math.round(selected[key] * 10) / 10}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          if (!Number.isFinite(v)) return
                          patchBlock(clampRect({ ...selected, [key]: v }))
                        }}
                        className="mt-0.5 w-full rounded-md border border-line px-2 py-1 text-[12px]"
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {mobileTab === 'content' && (
          <div className="overflow-hidden rounded-xl border border-line bg-white">
            <div className="flex border-b border-line">
              {(
                [
                  ['catalog', 'Каталог'],
                  ...((data?.layout.sections ?? 0) > 0 ? ([['places', 'Места']] as [LeftTab, string][]) : []),
                  ['layers', 'Слои'],
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
            <div className="max-h-[60vh] overflow-y-auto">
              {leftTab === 'catalog' ? catalogPane : leftTab === 'places' ? placesPane : layersPane}
            </div>
          </div>
        )}

        {mobileTab === 'design' && <div className="overflow-hidden rounded-xl border border-line bg-white">{rightTab === 'design' ? designPane : blockPane}</div>}

        {mobileTab === 'export' && (
          <div className="rounded-xl border border-line bg-white p-3">
            <h2 className="text-[15px] font-semibold">PDF для типографии</h2>
            <p className="mt-1 text-[12px] text-ink-secondary">
              {doc.pages.length} стр. · {data?.layout.formatHint.label} · текст останется векторным.
            </p>
            <ul className="mt-3 space-y-1.5 text-[12.5px]">
              <li className="flex items-start gap-2">
                <Check size={14} className="mt-0.5 flex-none text-ok" aria-hidden /> <span>Блоки печатаются на своих местах</span>
              </li>
              <li className="flex items-start gap-2">
                <Check size={14} className="mt-0.5 flex-none text-ok" aria-hidden /> <span>Поля под обрез 3 мм и метки реза</span>
              </li>
              {blockers.length > 0 && (
                <li className="flex items-start gap-2 text-bad">
                  <X size={14} className="mt-0.5 flex-none" aria-hidden />{' '}
                  <span>
                    {blockers.length} замечани(й): {blockers.slice(0, 2).map((b) => `${b.label} — ${b.text}`).join(', ')}
                  </span>
                </li>
              )}
            </ul>
            <Button className="mt-3 w-full" icon={<Download size={15} />} onClick={() => setExportOpen(true)}>
              Настроить PDF
            </Button>
          </div>
        )}
      </div>

      {/* ── командная палитра ⌘K ──────────────────────────── */}
      {paletteOpen && (
        <div
          className="fixed inset-0 z-[80] bg-black/50 p-4"
          onMouseDown={(e) => e.target === e.currentTarget && setPaletteOpen(false)}
        >
          <div
            role="dialog"
            aria-label="Команды редактора"
            className="mx-auto mt-[12vh] w-full max-w-[520px] overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <input
              autoFocus
              value={paletteQuery}
              onChange={(e) => {
                setPaletteQuery(e.target.value)
                setPaletteIndex(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setPaletteIndex((i) => Math.min(i + 1, paletteItems.length - 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setPaletteIndex((i) => Math.max(i - 1, 0))
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  runCommand(paletteIndex)
                } else if (e.key === 'Escape') {
                  setPaletteOpen(false)
                }
              }}
              placeholder="Что сделать? Например: фото, экспорт, колонки"
              aria-label="Поиск команды"
              className="min-h-12 w-full border-b border-line px-4 text-[14px] outline-none"
            />
            <ul className="max-h-[46vh] overflow-y-auto py-1">
              {paletteItems.map((cmd, i) => (
                <li key={cmd.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setPaletteIndex(i)}
                    onClick={() => runCommand(i)}
                    className={cx(
                      'flex w-full items-center gap-2 px-4 py-2 text-left text-[13px]',
                      i === paletteIndex ? 'bg-brand/10 text-ink' : 'text-ink-secondary',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{cmd.title}</span>
                    {cmd.hint && <span className="flex-none text-[11px] text-ink-tertiary">{cmd.hint}</span>}
                  </button>
                </li>
              ))}
              {paletteItems.length === 0 && (
                <li className="px-4 py-3 text-[13px] text-ink-tertiary">Ничего не найдено</li>
              )}
            </ul>
          </div>
        </div>
      )}

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
            <div className="shadow-2xl" style={{ aspectRatio: String(LAYOUT_FORMATS.find((f) => f.id === format)?.ratio ?? 210 / 297) }}>
              {canvas()}
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

      <Drawer open={versionsOpen} onClose={() => setVersionsOpen(false)} title="Версии макета" layer={70}>
        <p className="mb-3 text-[12.5px] text-ink-secondary">
          Версия — снимок листа и оформления. Перед откатом текущее состояние сохраняется автоматически, поэтому
          откат тоже можно отменить.
        </p>
        <div className="mb-3 flex gap-1">
          <Input
            value={versionNote}
            onChange={(e) => setVersionNote(e.target.value)}
            placeholder="Комментарий (необязательно)"
            aria-label="Комментарий к версии"
            className="!h-8 text-[12px]"
          />
          <Button size="sm" variant="secondary" onClick={() => void saveVersion()}>
            Сохранить версию
          </Button>
        </div>
        {versions.length === 0 && <p className="text-[12.5px] text-ink-tertiary">Версий пока нет.</p>}
        <ul className="space-y-1">
          {versions.map((v) => (
            <li key={v.id} className="flex items-center gap-2 rounded-lg border border-line px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-semibold">{v.note || v.title}</p>
                <p className="text-[11px] text-ink-tertiary">
                  {new Date(v.createdAt).toLocaleString('ru-RU')} · ревизия {v.rev} · {v.pages} стр. · {v.blocks} блоков
                </p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => void restoreVersion(v.id)}>
                Вернуть
              </Button>
              <button
                type="button"
                onClick={() => void removeVersion(v.id)}
                className="grid h-7 w-7 place-items-center rounded text-ink-tertiary hover:text-bad"
                aria-label="Удалить версию"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      </Drawer>

      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        layoutId={numericId}
        format={format}
        pages={doc.pages.length}
        blockers={
          blockers.length
            ? blockers
            : (data?.layout.blockers ?? []).map((b) => ({
                ...b,
                label: page.blocks.find((x) => x.id === b.blockId) ? blockLabel(page.blocks.find((x) => x.id === b.blockId)!) : 'Блок',
                pageIdx,
              }))
        }
        onDone={(ok, message) => toast.push(message, ok ? 'ok' : 'bad')}
        onBlocked={(message) => {
          toast.push(message, 'bad')
          setExportOpen(true)
        }}
        onGoToBlock={(blockId, pageIdx) => {
          setExportOpen(false)
          goToBlock(blockId, pageIdx)
        }}
      />

      {ctxMenu && (() => {
        const target = page.blocks.find((b) => b.id === ctxMenu.id)
        const item = (label: string, action: () => void, hint?: string, danger?: boolean) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              action()
              setCtxMenu(null)
            }}
            className={cx(
              'flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[12.5px] hover:bg-surface-2',
              danger ? 'text-bad' : 'text-ink',
            )}
          >
            <span>{label}</span>
            {hint && <span className="text-[10.5px] text-ink-tertiary">{hint}</span>}
          </button>
        )
        return (
          <>
            <div className="fixed inset-0 z-[85]" onPointerDown={() => setCtxMenu(null)} aria-hidden />
            <div
              role="menu"
              aria-label="Действия с блоком"
              className="fixed z-[86] w-56 overflow-hidden rounded-xl border border-line bg-white py-1 shadow-soft"
              style={{ left: Math.min(ctxMenu.x, window.innerWidth - 240), top: Math.min(ctxMenu.y, window.innerHeight - 300) }}
            >
              <p className="truncate px-3 py-1 text-[11px] uppercase tracking-wide text-ink-tertiary">
                {target ? layerName(target) : 'Блок'}
              </p>
              {item('Дублировать', () => duplicateBlocks([ctxMenu.id]), '⌘D')}
              {item('Копировать', () => {
                if (target) clipboard.current = target
                toast.push('Блок скопирован — ⌘V вставит')
              }, '⌘C')}
              {item(target?.locked ? 'Снять замок' : 'Закрепить', () => toggleLock(ctxMenu.id))}
              {item(target?.hidden ? 'Показать' : 'Скрыть', () => patchBlock({ hidden: !target?.hidden }, ctxMenu.id), 'Alt+Del')}
              <div className="my-1 h-px bg-line" />
              {item('На передний план', () => updatePage((blocks) => bringToFront(blocks, ctxMenu.id)))}
              {item('На задний план', () => updatePage((blocks) => sendToBack(blocks, ctxMenu.id)))}
              <div className="my-1 h-px bg-line" />
              {item('Переименовать', () => setRenamingId(ctxMenu.id))}
              {item('Удалить с листа', () => deleteBlock(ctxMenu.id), 'Del', true)}
            </div>
          </>
        )
      })()}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-[12px] text-ink-secondary">
        {MENU_LAYOUT_V2 && (data?.layout.sections ?? 0) > 0 && (
          <>
            <button type="button" onClick={() => void relayout()} className="text-brand hover:underline">
              Пересобрать лист
            </button>
            <span className="text-ink-tertiary">·</span>
          </>
        )}
        <button
          type="button"
          onClick={() => void setLayoutStatus(status === 'ready' ? 'draft' : 'ready')}
          className="text-brand hover:underline"
        >
          {status === 'ready' ? 'Вернуть в черновик' : 'Отметить готовым к печати'}
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

      <Drawer open={formatOpen} onClose={() => setFormatOpen(false)} title="Формат и шаблон" layer={65}>
        {MENU_LAYOUT_V2 && (data?.layout.sections ?? 0) > 0 && (
          <div className="mb-3 rounded-lg border border-line p-2">
            <p className="mb-1 text-[12px] font-semibold text-ink-secondary">Шаблон раскладки</p>
            <div className="flex flex-wrap gap-1">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => void applyTemplate(t.id)}
                  className="rounded-full border border-line px-2.5 py-1 text-[11px] font-semibold text-ink-secondary hover:border-brand hover:text-brand"
                >
                  {t.name}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-ink-tertiary">Шаблон меняет колонки и плотность, содержимое «Мест» остаётся.</p>
          </div>
        )}
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
              <span className="text-[11px] text-ink-tertiary">{f.unit === 'мм' ? `${f.mm} мм` : f.mm}</span>
            </button>
          ))}
        </div>
      </Drawer>
    </div>
  )
}

/* ───────────── экспорт PDF ───────────── */

type ExportProps = {
  open: boolean
  onClose: () => void
  layoutId: number
  format: LayoutFormat
  pages: number
  blockers: Blocker[]
  onGoToBlock: (blockId: string, pageIdx: number) => void
  /** Экспорт идёт в фоне: модалка закрывается сразу, итог приходит тостом. */
  onDone: (ok: boolean, message: string) => void
  /** 409: в макете есть дырки — просим владельца вернуться в модалку. */
  onBlocked: (message: string) => void
}

/**
 * Скелетон редактора: держит ту же сетку (панель — лист — панель), чтобы при загрузке
 * ничего не «прыгало». Дешевле спиннера по восприятию и не даёт layout shift.
 */
function EditorSkeleton() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Загружаем редактор макета">
      <div className="mb-3 h-9 rounded-xl bg-surface-2" />
      <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)_290px]">
        <div className="hidden space-y-2 rounded-xl border border-line bg-white p-3 lg:block">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-7 rounded-lg bg-surface-2" style={{ opacity: 1 - i * 0.07 }} />
          ))}
        </div>
        <div className="rounded-xl border border-line bg-[#e9ebef] p-4">
          <div className="mx-auto aspect-[210/297] w-full max-w-[520px] rounded-lg bg-white/80" />
        </div>
        <div className="hidden space-y-2 rounded-xl border border-line bg-white p-3 lg:block">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-8 rounded-lg bg-surface-2" style={{ opacity: 1 - i * 0.08 }} />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Подсказка о разрешении фото: 300×300 px в рамке 12 см дадут ~64 dpi и «мыло» на печати.
 * Ничего не блокирует — просто честно предупреждает до отправки в типографию.
 */
function PhotoDpiHint({ url, widthPct, ratio }: { url: string | null; widthPct: number; ratio: number }) {
  const [dpi, setDpi] = useState<number | null>(null)
  useEffect(() => {
    if (!url) {
      setDpi(null)
      return
    }
    let alive = true
    const img = new Image()
    img.onload = () => {
      if (alive) setDpi(effectiveDpi(img.naturalWidth, widthPct, sheetWidthMm(ratio)))
    }
    img.onerror = () => {
      if (alive) setDpi(null)
    }
    img.src = url
    return () => {
      alive = false
    }
  }, [url, widthPct, ratio])

  if (dpi == null || dpi >= 200) return null
  return (
    <p className="mt-1 text-[11px] text-warn">
      фото ≈ {dpi} dpi при этой ширине — на печати будет мыло (нужно ≥ 200)
    </p>
  )
}

function ExportModal({ open, onClose, layoutId, format, pages, blockers, onGoToBlock, onDone, onBlocked }: ExportProps) {
  const [preset, setPreset] = useState<'print' | 'screen'>('print')
  const [bleed, setBleed] = useState(3)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [forced, setForced] = useState(false)
  const [cmyk, setCmyk] = useState(false)

  useEffect(() => {
    if (!open) return
    setErr('')
    setForced(false)
  }, [open])

  if (!open) return null

  /**
   * Экспорт в фоне: закрываем модалку сразу после старта, чтобы можно было продолжать
   * работать. Итог приходит тостом, файл скачивается сам.
   */
  const download = (force: boolean) => {
    setBusy(true)
    setErr('')
    const startedAt = performance.now()
    const qs = new URLSearchParams({ preset, bleed: String(preset === 'print' ? bleed : 0) })
    if (cmyk) qs.set('cmyk', '1')
    if (force) qs.set('force', '1')
    onClose()
    void (async () => {
      try {
        const res = await fetch(`/api/admin/menu-layouts/${layoutId}/export.pdf?${qs.toString()}`, {
          headers: { 'X-Admin-Token': tokenStore.get() },
        })
        if (res.status === 409) {
          setForced(true)
          onBlocked('В макете есть незаполненные позиции — PDF не собран. Можно скачать как есть.')
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
        const ms = performance.now() - startedAt
        perfPdf(ms)
        onDone(true, `PDF готов за ${(ms / 1000).toFixed(1)} с · ${cmyk ? 'CMYK' : 'RGB'}, поля ${preset === 'print' ? bleed : 0} мм`)
      } catch (e) {
        onDone(false, e instanceof Error ? `PDF не собран: ${e.message}` : 'Не удалось скачать PDF')
      } finally {
        setBusy(false)
      }
    })()
  }

  const hard = blockers.filter((b) => b.code !== 'notice')

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Экспорт PDF" className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-soft">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-ink-tertiary">Печать и экран</p>
            <h2 className="text-lg font-bold">Экспорт PDF</h2>
            <p className="mt-0.5 text-[13px] text-ink-secondary">Файл для типографии или отправки гостю.</p>
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
                <Input value={formatFull(format)} readOnly />
              </Field>
              <Field label="Поля под обрез">
                <Select value={String(bleed)} onChange={(e) => setBleed(Number(e.target.value))} disabled={preset === 'screen'}>
                  <option value="3">3 мм (рекомендуется)</option>
                  <option value="0">0 мм</option>
                  <option value="5">5 мм</option>
                </Select>
              </Field>
              <label className="flex items-center gap-2 text-[12.5px] text-ink-secondary">
                <input type="checkbox" checked={cmyk} onChange={(e) => setCmyk(e.target.checked)} />
                Цвета в CMYK (для типографии)
              </label>
            </div>
          </div>

          <div className="rounded-xl border border-line p-3">
            <p className="mb-2 text-[12px] font-semibold text-ink-secondary">Что будет в файле</p>
            <ul className="space-y-1.5 text-[12.5px]">
              <li className="flex items-start gap-2">
                <Check size={14} className="mt-0.5 flex-none text-ok" aria-hidden /> Блоки печатаются на своих координатах
              </li>
              <li className="flex items-start gap-2">
                <Check size={14} className="mt-0.5 flex-none text-ok" aria-hidden /> Текст векторный, шрифты встроены
              </li>
              <li className="flex items-start gap-2">
                <Check size={14} className="mt-0.5 flex-none text-ok" aria-hidden /> {pages} стр. · метки реза при полях
              </li>
              <li className={cx('flex items-start gap-2', cmyk ? 'text-ink-secondary' : 'text-warn')}>
                <span className="mt-[3px] flex-none text-[11px] font-bold">{cmyk ? 'CMYK' : 'RGB'}</span>
                {cmyk
                  ? 'Цвета текста и плашек — Device CMYK. Фото остаются RGB, их конвертирует печатная машина.'
                  : 'Цвета в PDF — RGB. Для типографии включите CMYK или согласуйте профиль.'}
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
                    <button type="button" onClick={() => onGoToBlock(b.blockId, b.pageIdx)} className="text-left text-brand hover:underline">
                      {b.label} — {b.text} → открыть блок
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

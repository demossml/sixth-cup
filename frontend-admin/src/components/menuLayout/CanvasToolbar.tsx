import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical, Grid3x3, ListTree, Maximize2, Minus, Plus } from "lucide-react"
import type { RefObject } from "react"
import { Badge, cx } from "../../ui/kit"
import { FONT_FAMILIES, FONT_LABELS, LAYOUT_FORMATS, type LayoutFormat } from "../../lib/menuLayout"
import { fitZoom, zoomStep, type AlignMode } from "../../lib/menuTools"

type Props = {
  mode: "narrow" | "medium" | "wide"
  onOpenLeft: () => void
  formatHint: string
  formatMm: string
  status: "draft" | "ready"
  blockCount: number
  selectedIds: string[]
  editableCount: number
  onTakeStyle: () => void
  onApplyStyle: () => void
  onAlign: (mode: AlignMode) => void
  onDistribute: (axis: "x" | "y") => void
  onColumns: (n: 1 | 2 | 3) => void
  onGroup: () => void
  onUngroup: () => void
  onSameSize: (axis: "w" | "h") => void
  onBulkFontSize: (delta: number) => void
  onBulkFamily: (family: string) => void
  showGrid: boolean
  setShowGrid: (updater: (v: boolean) => boolean) => void
  gridStep: number
  setGridStep: (v: number) => void
  gridCols: number
  setGridCols: (v: number) => void
  showSafe: boolean
  setShowSafe: (updater: (v: boolean) => boolean) => void
  zoom: number
  setZoom: (updater: number | ((z: number) => number)) => void
  canvasBox: RefObject<HTMLDivElement | null>
  format: LayoutFormat
}

/** Панель над листом: массовые операции, сетка, поля и масштаб. */
export default function CanvasToolbar({
  mode,
  onOpenLeft,
  formatHint,
  formatMm,
  status,
  blockCount,
  selectedIds,
  editableCount,
  onTakeStyle,
  onApplyStyle,
  onAlign,
  onDistribute,
  onColumns,
  onGroup,
  onUngroup,
  onSameSize,
  onBulkFontSize,
  onBulkFamily,
  showGrid,
  setShowGrid,
  gridStep,
  setGridStep,
  gridCols,
  setGridCols,
  showSafe,
  setShowSafe,
  zoom,
  setZoom,
  canvasBox,
  format,
}: Props) {
  return (
<div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white px-2 py-1.5">
  <div className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-secondary">
    {mode === 'medium' && (
      <button
        type="button"
        onClick={() => onOpenLeft()}
        className="inline-flex h-8 flex-none items-center gap-1 rounded-md border border-line px-2 text-[12px] font-semibold text-ink-secondary hover:border-brand hover:text-brand"
        aria-label="Открыть каталог и слои"
      >
        <ListTree size={14} aria-hidden /> Состав
      </button>
    )}
    <span className="rounded-md bg-surface-2 px-2 py-1">
      {formatHint} · {formatMm}
    </span>
    <Badge tone={status === 'ready' ? 'ok' : 'neutral'}>{status === 'ready' ? 'Готов' : 'Черновик'}</Badge>
    <span className="text-[11px] font-normal text-ink-tertiary">{blockCount} блоков</span>
  </div>
  <div
    className={cx(
      'flex min-w-0 basis-full items-center gap-1 sm:basis-auto',
      // На планшете кнопок много: держим одну строку с прокруткой, чтобы
      // панель не занимала пол-экрана по высоте.
      mode === 'wide' ? 'flex-wrap justify-end' : 'mc-toolbar-scroll flex-nowrap justify-start',
    )}
  >
    {selectedIds.length > 0 && editableCount <= 1 && (
      <>
        <button type="button" onClick={onTakeStyle} className="h-8 rounded-md px-2 text-[11px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-brand" title="Скопировать стиль блока">
          стиль ↓
        </button>
        <button type="button" onClick={onApplyStyle} className="h-8 rounded-md px-2 text-[11px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-brand" title="Применить стиль к выделенным">
          стиль ↑
        </button>
        <span className="mx-1 h-5 w-px bg-line" />
      </>
    )}
    {editableCount > 1 && (
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
        ).map(([key, Icon, title]) => (
          <button
            key={mode}
            type="button"
            onClick={() => onAlign(key)}
            className="grid h-8 w-8 place-items-center rounded-md text-ink-tertiary hover:bg-surface-2 hover:text-brand"
            aria-label={title}
            title={title}
          >
            <Icon size={15} />
          </button>
        ))}
        <button type="button" onClick={() => onDistribute('x')} className="h-8 rounded-md px-2 text-[11px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-brand" title="Равные промежутки по горизонтали">
          ⇿
        </button>
        <button type="button" onClick={() => onDistribute('y')} className="h-8 rounded-md px-2 text-[11px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-brand" title="Равные промежутки по вертикали">
          ⇅
        </button>
        <span className="mx-1 h-5 w-px bg-line" />
        <button type="button" onClick={() => onColumns(1)} className="h-8 rounded-md px-2 text-[11px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-brand" title="Разложить в одну колонку">
          1 кол.
        </button>
        <button type="button" onClick={() => onColumns(2)} className="h-8 rounded-md px-2 text-[11px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-brand" title="Разложить в две колонки">
          2 кол.
        </button>
        <button type="button" onClick={() => onColumns(3)} className="h-8 rounded-md px-2 text-[11px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-brand" title="Разложить в три колонки">
          3 кол.
        </button>
        <span className="mx-1 h-5 w-px bg-line" />
        <button type="button" onClick={onGroup} className="h-8 rounded-md px-2 text-[11px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-brand" title="Сгруппировать выделенные блоки">
          группа
        </button>
        <button type="button" onClick={onUngroup} className="h-8 rounded-md px-2 text-[11px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-brand" title="Разгруппировать">
          разбить
        </button>
        <button type="button" onClick={() => onSameSize('w')} className="h-8 rounded-md px-2 text-[11px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-brand" title="Одинаковая ширина по опорному блоку">
          = шир.
        </button>
        <button type="button" onClick={() => onSameSize('h')} className="h-8 rounded-md px-2 text-[11px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-brand" title="Одинаковая высота по опорному блоку">
          = выс.
        </button>
        <span className="mx-1 h-5 w-px bg-line" />
        <button type="button" onClick={() => onBulkFontSize(-0.5)} className="h-8 w-8 rounded-md text-[12px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-brand" title="Уменьшить кегль всех выделенных на 0,5 pt" aria-label="Уменьшить кегль выделенных">
          A−
        </button>
        <button type="button" onClick={() => onBulkFontSize(0.5)} className="h-8 w-8 rounded-md text-[12px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-brand" title="Увеличить кегль всех выделенных на 0,5 pt" aria-label="Увеличить кегль выделенных">
          A+
        </button>
        <select
          value=""
          onChange={(e) => e.target.value && onBulkFamily(e.target.value)}
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
        <button type="button" onClick={onTakeStyle} className="h-8 rounded-md px-2 text-[11px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-brand" title="Скопировать стиль с активного блока">
          стиль ↓
        </button>
        <button type="button" onClick={onApplyStyle} className="h-8 rounded-md px-2 text-[11px] font-semibold text-ink-tertiary hover:bg-surface-2 hover:text-brand" title="Применить скопированный стиль к выделенным">
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
  )
}

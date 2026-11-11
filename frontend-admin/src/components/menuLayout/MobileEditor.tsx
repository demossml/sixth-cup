import { Check, Download, Eye, ListTree, Palette, X } from "lucide-react"
import { Button, cx } from "../../ui/kit"
import { LAYOUT_FORMATS, type LayoutFormat, type MenuBlock } from "../../lib/menuLayout"
import type { MobileTab, RightTab, LeftTab } from "../../lib/menuTools"
import type { Blocker } from "./ExportModal"

type Rect = MenuBlock

type Props = {
  mode: "narrow" | "medium" | "wide"
  mobileTab: MobileTab
  setMobileTab: (t: MobileTab) => void
  format: LayoutFormat
  pageIdx: number
  setPageIdx: (updater: (i: number) => number) => void
  pageCount: number
  canvas: React.ReactNode
  selected: MenuBlock | null
  layerName: (b: MenuBlock) => string
  patchRect: (rect: Rect) => void
  leftTab: LeftTab
  setLeftTab: (t: LeftTab) => void
  hasSections: boolean
  rightTab: RightTab
  catalogPane: React.ReactNode
  placesPane: React.ReactNode
  layersPane: React.ReactNode
  designPane: React.ReactNode
  blockPane: React.ReactNode
  formatHint: string
  blockers: Blocker[]
  onExport: () => void
}

/** Мобильный режим: вкладки «Превью / Состав / Дизайн / PDF» вместо трёх колонок. */
export default function MobileEditor(props: Props) {
  const {
    mode,
    mobileTab,
    setMobileTab,
    format,
    pageIdx,
    setPageIdx,
    pageCount,
    canvas,
    selected,
    layerName,
    patchRect,
    leftTab,
    setLeftTab,
    hasSections,
    rightTab,
    catalogPane,
    placesPane,
    layersPane,
    designPane,
    blockPane,
    formatHint,
    blockers,
    onExport,
  } = props
  return (
    <>
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

      <div className={mode === 'narrow' ? '' : 'hidden'}>
    {mobileTab === 'preview' && (
      <div className="rounded-xl border border-line bg-[#e9ebef] p-3">
        <div
          className="mx-auto max-w-[360px] shadow-[0_10px_30px_rgba(16,24,40,.15)]"
          style={{ aspectRatio: String(LAYOUT_FORMATS.find((f) => f.id === format)?.ratio ?? 210 / 297) }}
        >
          {canvas}
        </div>
        <div className="mt-2 flex items-center justify-center gap-2 text-[12px] text-ink-secondary">
          <button type="button" onClick={() => setPageIdx((i) => Math.max(0, i - 1))} disabled={pageIdx === 0} className="rounded-md border border-line px-2 py-1 disabled:opacity-40">
            ← стр.
          </button>
          <span className="tabular-nums">
            {pageIdx + 1} / {pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPageIdx((i) => Math.min(pageCount - 1, i + 1))}
            disabled={pageIdx >= pageCount - 1}
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
                      patchRect({ ...selected, [key]: v })
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
              ...(hasSections ? ([['places', 'Места']] as [LeftTab, string][]) : []),
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
          {pageCount} стр. · {formatHint} · текст останется векторным.
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
        <Button className="mt-3 w-full" icon={<Download size={15} />} onClick={() => onExport()}>
          Настроить PDF
        </Button>
      </div>
        )}
      </div>
    </>
  )
}

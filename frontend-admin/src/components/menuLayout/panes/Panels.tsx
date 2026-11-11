import type { ReactNode } from 'react'
import { Plus, X } from 'lucide-react'
import { cx } from '../../../ui/kit'
import type { LeftTab, RightTab } from '../../../lib/menuTools'

type Props = {
  leftTab: LeftTab
  setLeftTab: (t: LeftTab) => void
  hasSections: boolean
  catalogPane: ReactNode
  placesPane: ReactNode
  layersPane: ReactNode
}

/** Левая панель: «Каталог / Места / Слои» на широком экране и в шторке планшета. */
export default function LeftPanel({ leftTab, setLeftTab, hasSections, catalogPane, placesPane, layersPane }: Props) {
  const tabs: [LeftTab, string][] = [
    ['catalog', 'Каталог'],
    ...(hasSections ? ([['places', 'Места']] as [LeftTab, string][]) : []),
    ['layers', 'Слои'],
  ]
  return (
    <aside className="flex h-full max-h-[calc(100vh-230px)] min-h-[320px] flex-col overflow-hidden rounded-xl border border-line bg-white">
      <div className="flex border-b border-line">
        {tabs.map(([k, label]) => (
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
}

type RightProps = {
  rightTab: RightTab
  setRightTab: (t: RightTab) => void
  designPane: ReactNode
  blockPane: ReactNode
}

/** Правая панель: «Оформление» и «Блок». */
export function RightPanel({ rightTab, setRightTab, designPane, blockPane }: RightProps) {
  const tabs: [RightTab, string][] = [
    ['design', 'Оформление'],
    ['block', 'Блок'],
  ]
  return (
    <aside className="flex max-h-[calc(100vh-230px)] min-h-[460px] flex-col overflow-hidden rounded-xl border border-line bg-white">
      <div className="flex border-b border-line">
        {tabs.map(([k, label]) => (
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
  )
}

type PageBarProps = {
  pages: { id: string; blocks: unknown[] }[]
  pageIdx: number
  setPageIdx: (i: number) => void
  onRemovePage: (i: number) => void
  onAddPage: () => void
  savedLabel: string
}

/** Нижняя строка листа: страницы и подсказка про автосохранение. */
export function PageBar({ pages, pageIdx, setPageIdx, onRemovePage, onAddPage, savedLabel }: PageBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-xl border border-line bg-white px-2 py-1.5">
      {pages.map((p, i) => (
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
          {pages.length > 1 && (
            <button
              type="button"
              onClick={() => onRemovePage(i)}
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
        onClick={onAddPage}
        className="grid h-7 w-7 place-items-center rounded-md border border-dashed border-line text-ink-tertiary hover:border-brand hover:text-brand"
        title="Добавить страницу"
        aria-label="Добавить страницу"
      >
        <Plus size={13} />
      </button>
      <span className="ml-auto text-[11px] text-ink-tertiary">{savedLabel}</span>
    </div>
  )
}

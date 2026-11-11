import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Eye, EyeOff, GripVertical, Lock, LockOpen, Search, Trash2, X } from 'lucide-react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { cx } from '../../../ui/kit'
import { blockLabel, bringToFront, byZ, sendToBack, toggleHidden, type MenuBlock } from '../../../lib/menuLayout'
import { reorderBlocks } from '../../../lib/menuTools'

type Props = {
  blocks: MenuBlock[]
  layerQuery: string
  setLayerQuery: (v: string) => void
  layerName: (b: MenuBlock) => string
  collapsedGroups: string[]
  setCollapsedGroups: (v: (cur: string[]) => string[]) => void
  selectedIds: string[]
  setSelectedIds: (ids: string[]) => void
  selectBlock: (id: string, e?: ReactPointerEvent<HTMLDivElement>) => void
  ungroupSelection: () => void
  layerDragId: string | null
  setLayerDragId: (id: string | null) => void
  renamingId: string | null
  setRenamingId: (id: string | null) => void
  patchBlock: (patch: Partial<MenuBlock>, id?: string | null) => void
  toggleLock: (id: string) => void
  updatePage: (updater: (blocks: MenuBlock[]) => MenuBlock[]) => void
  deleteBlock: (id: string) => void
  commentCounts: Record<string, number>
  dupes: { productId: number; blockIds: string[] }[]
  removeDuplicates: () => void
}

/** Панель «Слои»: порядок, группы, замки, замечания и дубли. */
export default function LayersPane({
  blocks,
  layerQuery,
  setLayerQuery,
  layerName,
  collapsedGroups,
  setCollapsedGroups,
  selectedIds,
  setSelectedIds,
  selectBlock,
  ungroupSelection,
  layerDragId,
  setLayerDragId,
  renamingId,
  setRenamingId,
  patchBlock,
  toggleLock,
  updatePage,
  deleteBlock,
  commentCounts,
  dupes,
  removeDuplicates,
}: Props) {
  const matched = (b: MenuBlock) => layerName(b).toLowerCase().includes(layerQuery.toLowerCase())
  return (
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
        {blocks.length === 0 && (
          <p className="p-2 text-[13px] text-ink-secondary">Холст пуст. Добавьте позиции из каталога или текст.</p>
        )}
        {blocks.length > 0 && layerQuery && byZ(blocks).filter(matched).length === 0 && (
          <p className="p-2 text-[12.5px] text-ink-secondary">Ничего не найдено по «{layerQuery}».</p>
        )}
        {(() => {
          const groups = new Map<string, MenuBlock[]>()
          for (const b of blocks) if (b.groupId) groups.set(b.groupId, [...(groups.get(b.groupId) ?? []), b])
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
          {byZ(blocks)
            .filter((b) => !b.groupId)
            .filter((b) => !layerQuery || matched(b))
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
                    updatePage((bs) => reorderBlocks(bs, layerDragId, b.id))
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
                {commentCounts[b.id] > 0 && (
                  <span
                    className="grid h-5 min-w-5 flex-none place-items-center rounded-full bg-warn-soft px-1 text-[10px] font-bold text-warn"
                    title={`Замечаний: ${commentCounts[b.id]}`}
                  >
                    {commentCounts[b.id]}
                  </span>
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
                  onClick={() => updatePage((bs) => bringToFront(bs, b.id))}
                  className="grid h-6 w-6 place-items-center rounded text-ink-tertiary hover:text-brand"
                  aria-label="На передний план"
                  title="На передний план"
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => updatePage((bs) => sendToBack(bs, b.id))}
                  className="grid h-6 w-6 place-items-center rounded text-ink-tertiary hover:text-brand"
                  aria-label="На задний план"
                  title="На задний план"
                >
                  <ArrowDown size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => updatePage((bs) => toggleHidden(bs, b.id))}
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
}

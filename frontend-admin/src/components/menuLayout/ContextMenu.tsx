import { cx } from '../../ui/kit'
import { bringToFront, sendToBack, type MenuBlock } from '../../lib/menuLayout'

export type CtxTarget = { x: number; y: number; id: string }

type Props = {
  menu: CtxTarget
  blocks: MenuBlock[]
  layerName: (b: MenuBlock) => string
  close: () => void
  duplicate: (id: string) => void
  copy: (block: MenuBlock) => void
  toggleLock: (id: string) => void
  setHidden: (id: string, hidden: boolean) => void
  bringFront: (id: string) => void
  sendBack: (id: string) => void
  rename: (id: string) => void
  remove: (id: string) => void
}

/** Контекстное меню блока: дубли, порядок, замок, переименование, удаление. */
export default function ContextMenu({
  menu,
  blocks,
  layerName,
  close,
  duplicate,
  copy,
  toggleLock,
  setHidden,
  bringFront,
  sendBack,
  rename,
  remove,
}: Props) {
  const target = blocks.find((b) => b.id === menu.id)
  const item = (label: string, action: () => void, hint?: string, danger?: boolean) => (
    <button
      key={label}
      type="button"
      onClick={() => {
        action()
        close()
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
      <div className="fixed inset-0 z-[85]" onPointerDown={close} aria-hidden />
      <div
        role="menu"
        aria-label="Действия с блоком"
        className="fixed z-[86] w-56 overflow-hidden rounded-xl border border-line bg-white py-1 shadow-soft"
        style={{ left: Math.min(menu.x, window.innerWidth - 240), top: Math.min(menu.y, window.innerHeight - 300) }}
      >
        <p className="truncate px-3 py-1 text-[11px] uppercase tracking-wide text-ink-tertiary">
          {target ? layerName(target) : 'Блок'}
        </p>
        {item('Дублировать', () => duplicate(menu.id), '⌘D')}
        {item('Копировать', () => target && copy(target), '⌘C')}
        {item(target?.locked ? 'Снять замок' : 'Закрепить', () => toggleLock(menu.id))}
        {item(target?.hidden ? 'Показать' : 'Скрыть', () => setHidden(menu.id, !target?.hidden), 'Alt+Del')}
        <div className="my-1 h-px bg-line" />
        {item('На передний план', () => bringFront(menu.id))}
        {item('На задний план', () => sendBack(menu.id))}
        <div className="my-1 h-px bg-line" />
        {item('Переименовать', () => rename(menu.id))}
        {item('Удалить с листа', () => remove(menu.id), 'Del', true)}
      </div>
    </>
  )
}

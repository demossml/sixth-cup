import { Button, Drawer } from "../../../ui/kit"
import { ago } from "../../../lib/format"

type Props = {
  open: boolean
  onClose: () => void
  notes: { id: string; blockId: string; text: string; author?: string | null; createdAt: number }[]
  blockName: (id: string) => string | null
  pageIndex: (id: string) => number
  goToBlock: (blockId: string, page: number) => void
  toggleNote: (id: string, resolved: boolean) => void
  deleteNote: (id: string) => void
  onDropOrphans: () => void
}

/** Шторка со всеми открытыми замечаниями макета. */
export default function NotesDrawer({ open, onClose, notes, blockName, pageIndex, goToBlock, toggleNote, deleteNote, onDropOrphans }: Props) {
  return (
    <Drawer open={open} onClose={() => onClose()} title={`Замечания${notes.length ? ` · ${notes.length}` : ''}`} layer={64}>
      {notes.length === 0 ? (
        <p className="text-[12.5px] text-ink-secondary">
          Открытых замечаний нет. Выберите блок на листе и напишите замечание в панели «Блок» — оно повиснет на
          блоке и уйдёт в PDF стикером.
        </p>
      ) : (
        <ul className="space-y-2">
          {notes.map((c) => {
            const pi = pageIndex(c.blockId)
            return (
              <li key={c.id} className="rounded-lg border border-warn/40 bg-warn-soft/40 p-2">
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    if (pi >= 0) goToBlock(c.blockId, pi)
                  }}
                  className="block w-full text-left"
                >
                  <p className="truncate text-[12.5px] font-semibold text-ink">
                    {blockName(c.blockId) ?? 'Блок удалён'}
                  </p>
                  <p className="mt-0.5 text-[12px] text-ink-secondary">{c.text}</p>
                  <p className="mt-0.5 text-[10.5px] text-ink-tertiary">
                    {c.author ? `${c.author} · ` : ''}
                    {ago(c.createdAt)} · {pi >= 0 ? `стр. ${pi + 1}` : 'нет на листе'}
                  </p>
                </button>
                <div className="mt-1 flex gap-3 text-[11px] font-semibold">
                  <button type="button" onClick={() => toggleNote(c.id, true)} className="text-brand hover:underline">
                    решено
                  </button>
                  <button type="button" onClick={() => deleteNote(c.id)} className="text-ink-tertiary hover:text-bad">
                    удалить
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {notes.some((c) => !blockName(c.blockId)) && (
        <Button size="sm" variant="secondary" className="mt-3" onClick={onDropOrphans}>
          Убрать замечания удалённых блоков
        </Button>
      )}
    </Drawer>
  )
}

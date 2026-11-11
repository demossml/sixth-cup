import { Trash2 } from "lucide-react"
import { Button, Drawer, Input } from "../../../ui/kit"

type Version = { id: number; note: string | null; title: string; createdAt: number; rev: number; pages: number; blocks: number }

type Props = {
  open: boolean
  onClose: () => void
  note: string
  setNote: (v: string) => void
  onSave: () => void
  versions: Version[]
  onRestore: (id: number) => void
  onRemove: (id: number) => void
}

/** Шторка «Версии»: снимки листа и оформления с откатом. */
export default function VersionsDrawer({ open, onClose, note, setNote, onSave, versions, onRestore, onRemove }: Props) {
  return (
    <Drawer open={open} onClose={() => onClose()} title="Версии макета" layer={70}>
      <p className="mb-3 text-[12.5px] text-ink-secondary">
        Версия — снимок листа и оформления. Перед откатом текущее состояние сохраняется автоматически, поэтому
        откат тоже можно отменить.
      </p>
      <div className="mb-3 flex gap-1">
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Комментарий (необязательно)"
          aria-label="Комментарий к версии"
          className="!h-8 text-[12px]"
        />
        <Button size="sm" variant="secondary" onClick={() => void onSave()}>
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
            <Button size="sm" variant="secondary" onClick={() => void onRestore(v.id)}>
              Вернуть
            </Button>
            <button
              type="button"
              onClick={() => void onRemove(v.id)}
              className="grid h-7 w-7 place-items-center rounded text-ink-tertiary hover:text-bad"
              aria-label="Удалить версию"
            >
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ul>
    </Drawer>
  )
}

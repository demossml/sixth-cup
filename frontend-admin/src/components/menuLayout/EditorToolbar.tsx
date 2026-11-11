import { Link } from "react-router-dom"
import { ArrowLeft, Download, Eye, History, Link2, Loader2, MessageSquare, Redo2, Undo2 } from "lucide-react"
import { Button, cx } from "../../ui/kit"

type Props = {
  mode: "narrow" | "medium" | "wide"
  title: string
  setTitle: (v: string) => void
  save: "idle" | "dirty" | "saving" | "saved" | "error"
  statusLabel: string
  saveStateText: string
  formatLine: string
  pageCount: number
  priceMode: "live" | "frozen"
  frozenLabel: string
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  onPreview: () => void
  onVersions: () => void
  onNotes: () => void
  notesCount: number
  onExport: () => void
  onShare: () => void
}

/** Верхняя строка редактора: название, статус сохранения и основные действия. */
export default function EditorToolbar({
  mode,
  title,
  setTitle,
  save,
  statusLabel,
  saveStateText,
  formatLine,
  pageCount,
  priceMode,
  frozenLabel,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onPreview,
  onVersions,
  onNotes,
  notesCount,
  onExport,
  onShare,
}: Props) {
  return (
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
          {formatLine} · {pageCount} стр. ·{' '}
          {priceMode === 'frozen' ? `цены зафиксированы${frozenLabel}` : 'цены из каталога'}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="secondary" icon={<Undo2 size={14} />} onClick={onUndo} disabled={!canUndo}>
          Отменить
        </Button>
        <Button size="sm" variant="secondary" icon={<Redo2 size={14} />} onClick={onRedo} disabled={!canRedo}>
          Вернуть
        </Button>
        <Button size="sm" variant="secondary" icon={<Eye size={14} />} onClick={() => onPreview()}>
          Предпросмотр
        </Button>
        <Button size="sm" variant="secondary" icon={<History size={14} />} onClick={() => onVersions()}>
          Версии
        </Button>
        <Button
          size="sm"
          variant="secondary"
          icon={<MessageSquare size={14} />}
          onClick={() => onNotes()}
        >
          Замечания{notesCount > 0 ? ` · ${notesCount}` : ''}
        </Button>
        <Button size="sm" variant="secondary" icon={<Link2 size={14} />} onClick={() => onShare()}>
          Поделиться
        </Button>
        <Button size="sm" icon={<Download size={14} />} onClick={() => onExport()}>
          Экспорт PDF
        </Button>
      </div>
    </div>
  )
}

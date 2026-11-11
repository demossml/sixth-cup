import { cx } from "../../../ui/kit"

type Command = { id: string; title: string; hint?: string }

type Props = {
  query: string
  setQuery: (v: string) => void
  index: number
  setIndex: (updater: number | ((i: number) => number)) => void
  items: Command[]
  onRun: (index: number) => void
  close: () => void
}

/** Командная палитра ⌘K: поиск по действиям редактора. */
export default function CommandPalette({
  query: paletteQuery,
  setQuery: setPaletteQuery,
  index: paletteIndex,
  setIndex: setPaletteIndex,
  items: paletteItems,
  onRun: runCommand,
  close,
}: Props) {
  return (
    <div
      className="fixed inset-0 z-[80] bg-black/50 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
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
              close()
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
  )
}

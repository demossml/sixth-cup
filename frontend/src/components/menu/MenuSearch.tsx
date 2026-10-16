import { Search, X } from 'lucide-react'

type Props = { value: string; onChange: (v: string) => void }

/** Поле поиска. 16px — чтобы iOS Safari не зумил страницу при фокусе. */
export default function MenuSearch({ value, onChange }: Props) {
  return (
    <div className="relative">
      <Search size={18} strokeWidth={1.75} aria-hidden="true" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-tertiary pointer-events-none" />
      <input
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Найти в меню"
        aria-label="Найти в меню"
        className="w-full min-h-11 pl-10 pr-11 rounded-xl border border-line bg-white text-[16px] text-ink placeholder:text-ink-tertiary focus:outline-none focus:border-brand-mid focus:ring-2 focus:ring-brand-tint [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Очистить поиск"
          className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full text-ink-secondary"
        >
          <X size={18} strokeWidth={1.75} />
        </button>
      ) : null}
    </div>
  )
}

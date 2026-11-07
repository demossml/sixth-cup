import { MapPin, Search, X } from 'lucide-react'
import { storeHours } from '../../lib/menuModel'

type Store = {
  id: number
  name: string
  address: string
  openTime?: string | null
  closeTime?: string | null
}

type Props = {
  store: Store | null
  /** Показать поле поиска (кнопка в шапке раскрывает его на месте). */
  searchOpen: boolean
  query: string
  onQuery: (v: string) => void
  onToggleSearch: (open: boolean) => void
  onChangeStore: () => void
}

/**
 * Шапка экрана меню как в макете: логотип-маскот + «6.7 COFFEE» и кнопка поиска,
 * ниже — строка выбранной кофейни с часами и «изменить».
 */
export default function MenuHeader({ store, searchOpen, query, onQuery, onToggleSearch, onChangeStore }: Props) {
  const hours = store ? storeHours(store) : null
  return (
    <header className="px-4" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <img src="/logo-mark.png" alt="" className="w-10 h-10 rounded-xl object-contain" aria-hidden="true" />
          <span className="font-display text-[15px] leading-5 font-semibold tracking-[0.14em] text-ink uppercase">
            6.7 Coffee
          </span>
        </div>
        <button
          type="button"
          onClick={() => onToggleSearch(!searchOpen)}
          aria-label={searchOpen ? 'Закрыть поиск' : 'Поиск'}
          aria-expanded={searchOpen}
          className="w-11 h-11 rounded-full bg-white border border-line flex items-center justify-center text-ink shrink-0"
        >
          {searchOpen ? <X size={18} strokeWidth={1.75} /> : <Search size={18} strokeWidth={1.75} />}
        </button>
      </div>

      {searchOpen && (
        <div className="mt-3">
          <input
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoFocus
            autoComplete="off"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Найти в меню"
            aria-label="Найти в меню"
            className="w-full min-h-11 px-4 rounded-xl border border-line bg-white text-[16px] text-ink placeholder:text-ink-tertiary focus:outline-none focus:border-brand-mid focus:ring-2 focus:ring-brand-tint [&::-webkit-search-cancel-button]:hidden"
          />
        </div>
      )}

      {store && (
        <button
          type="button"
          onClick={onChangeStore}
          className="mt-3 w-full flex items-center gap-2 text-left text-[14px] leading-5 text-ink"
        >
          <MapPin size={16} strokeWidth={1.75} className="text-brand shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">
            {store.name}
            {hours?.label ? <span className="text-ink-secondary">{` · ${hours.label}`}</span> : null}
          </span>
          <span className="ml-auto shrink-0 text-[13px] font-semibold text-brand underline">изменить</span>
        </button>
      )}
    </header>
  )
}

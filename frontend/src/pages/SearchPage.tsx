import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Search as SearchIcon, X } from 'lucide-react'
import { useApp } from '../lib/app'
import { buildMenuItems, searchItems, type MenuDirectory, type MenuItem } from '../lib/menuModel'
import ProductCard from '../components/menu/ProductCard'
import StateBlock from '../components/StateBlock'

const HISTORY_KEY = 'sc_search_history'
const HISTORY_MAX = 5
/** Пока гость печатает, сетку не перерисовываем на каждый символ. */
const DEBOUNCE_MS = 120

function readHistory(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string').slice(0, HISTORY_MAX) : []
  } catch {
    return []
  }
}

function pushHistory(q: string, prev: string[]): string[] {
  const v = q.trim()
  if (v.length < 2) return prev
  const next = [v, ...prev.filter((x) => x.toLowerCase() !== v.toLowerCase())].slice(0, HISTORY_MAX)
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
  } catch {
    /* приватный режим — история просто не сохранится */
  }
  return next
}

/**
 * Полноэкранный поиск по меню (пункт 11 плана): автофокус, история последних запросов,
 * результаты сеткой. Открывается из шапки меню, `/search?q=` — сразу с запросом.
 */
export default function SearchPage() {
  const { dir: rawDir } = useApp()
  const dir = rawDir as MenuDirectory | null
  const nav = useNavigate()
  const [params] = useSearchParams()
  const [query, setQuery] = useState(() => params.get('q') ?? '')
  const [debounced, setDebounced] = useState(query)
  const [history, setHistory] = useState<string[]>(readHistory)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const items = useMemo(() => (dir ? buildMenuItems(dir) : []), [dir])
  const active = debounced.trim().length > 0
  const results = useMemo(() => (active ? searchItems(items, debounced) : []), [items, debounced, active])

  const openItem = (it: MenuItem) => {
    setHistory((h) => pushHistory(query, h))
    nav(`/menu/${it.product.id}`, { replace: true })
  }

  const applyHistory = (q: string) => {
    setQuery(q)
    setDebounced(q)
    inputRef.current?.focus()
  }

  const clearHistory = () => {
    setHistory([])
    try {
      localStorage.removeItem(HISTORY_KEY)
    } catch {
      /* ignore */
    }
  }

  const onBack = () => {
    setHistory((h) => pushHistory(query, h))
    nav(-1)
  }

  return (
    <main className="pb-28">
      <div className="px-4" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            aria-label="Назад"
            className="w-11 h-11 rounded-full bg-white border border-line flex items-center justify-center text-ink shrink-0"
          >
            <ArrowLeft size={18} strokeWidth={1.75} />
          </button>
          <div className="relative flex-1 min-w-0">
            <SearchIcon
              size={17}
              strokeWidth={1.75}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary pointer-events-none"
              aria-hidden="true"
            />
            <input
              ref={inputRef}
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onBlur={() => setHistory((h) => pushHistory(query, h))}
              placeholder="Найти в меню"
              aria-label="Найти в меню"
              className="w-full min-h-11 pl-9 pr-10 rounded-xl border border-line bg-white text-[16px] text-ink placeholder:text-ink-tertiary focus:outline-none focus:border-brand-mid focus:ring-2 focus:ring-brand-tint [&::-webkit-search-cancel-button]:hidden"
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  inputRef.current?.focus()
                }}
                aria-label="Очистить"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center text-ink-secondary"
              >
                <X size={16} strokeWidth={2} />
              </button>
            ) : null}
          </div>
        </div>

        {!active && history.length > 0 && (
          <section className="mt-4" aria-label="Вы искали">
            <div className="flex items-center justify-between gap-3 mb-2">
              <h2 className="text-[13px] leading-5 font-semibold tracking-wide uppercase text-ink-secondary">Вы искали</h2>
              <button type="button" onClick={clearHistory} className="text-[13px] leading-5 text-brand underline">
                Очистить
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {history.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => applyHistory(h)}
                  className="min-h-9 px-3 rounded-full border border-line bg-white text-[14px] leading-5 text-ink"
                >
                  {h}
                </button>
              ))}
            </div>
          </section>
        )}

        {!active && history.length === 0 && (
          <section className="mt-6" aria-label="Подсказки">
            <h2 className="text-[13px] leading-5 font-semibold tracking-wide uppercase text-ink-secondary mb-2">
              Попробуйте поискать
            </h2>
            <div className="flex flex-wrap gap-2">
              {['Капучино', 'Латте', 'Круассан', 'Матча', 'Раф'].map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => applyHistory(h)}
                  className="min-h-9 px-3 rounded-full border border-line bg-white text-[14px] leading-5 text-ink"
                >
                  {h}
                </button>
              ))}
            </div>
          </section>
        )}

        {active && (
          <p className="mt-4 mb-2 text-[13px] leading-5 text-ink-secondary" aria-live="polite">
            {results.length > 0 ? `Найдено: ${results.length}` : ''}
          </p>
        )}
      </div>

      {active && results.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 px-4">
          {results.map((it, i) => (
            <ProductCard key={it.product.id} item={it} onSelect={openItem} eager={i < 2} defer={i >= 6} />
          ))}
        </div>
      ) : active ? (
        <div className="px-4">
          <StateBlock
            title="Ничего не нашли"
            body={`По запросу «${debounced.trim()}» в меню пусто. Попробуйте короче — например, «каппучино» или «круассан».`}
            actionLabel="Сбросить"
            onAction={() => setQuery('')}
          />
        </div>
      ) : null}
    </main>
  )
}

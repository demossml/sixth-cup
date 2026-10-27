import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getJwt } from '../api'
import { formatRub } from '../lib/money'
import { cupsWord } from '../lib/plural'
import { fmtClock } from '../lib/syncStatus'
import { ArrowLeft, RefreshCw } from '../lib/icons'

type Item = {
  id: string; at: string; kind: string; title: string
  cupsDelta: number; cashbackDeltaKop: number; resultRub: number | null; status: string
}
type Response = { items: Item[]; nextCursor: string | null }
type Cache = { items: Item[]; at: number }
const CACHE_KEY = 'sc-history-cache'

function readCache(): Cache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as Cache) : null
  } catch { return null }
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yest = new Date(today.getTime() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Сегодня'
  if (d.toDateString() === yest.toDateString()) return 'Вчера'
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

/** Правая колонка: кэшбэк (+4,50 ₽) или сумма покупки без округления до рублей. */
function amountOf(i: Item): string {
  if (i.cashbackDeltaKop) return `${i.cashbackDeltaKop > 0 ? '+' : '−'}${formatRub(Math.abs(i.cashbackDeltaKop))} ₽`
  if (i.resultRub !== null && i.resultRub !== undefined) return `${formatRub(Math.round(i.resultRub * 100))} ₽`
  return ''
}

/**
 * История — только то, что подтвердил сервер (policy B: покупки/возвраты + реферальный кэшбэк, без дублей ledger).
 * Клиент ничего не начисляет и не досчитывает сам.
 */
export default function HistoryPage() {
  const initial = readCache()
  const [items, setItems] = useState<Item[]>(initial?.items ?? [])
  const [cachedAt, setCachedAt] = useState<number>(initial?.at ?? 0)
  const [fromCache, setFromCache] = useState(!!initial)
  const [cursor, setCursor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (next: string | null = null, append = false) => {
    setBusy(true); setError('')
    try {
      const r = await fetch(`/api/sync/history?limit=30${next ? `&cursor=${encodeURIComponent(next)}` : ''}`, {
        headers: { Authorization: `Bearer ${getJwt()}` },
      })
      if (!r.ok) throw new Error('http')
      const d = (await r.json()) as Response
      setItems((old) => {
        const merged = append ? [...old, ...d.items.filter((it) => !old.some((x) => x.id === it.id))] : d.items
        const at = Date.now()
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ items: merged, at })) } catch { /* private mode */ }
        setCachedAt(at)
        return merged
      })
      setFromCache(false)
      setCursor(d.nextCursor)
    } catch {
      setError(navigator.onLine ? 'Не удалось загрузить историю. Попробуйте ещё раз.' : 'Нет сети — показана сохранённая история.')
    } finally { setBusy(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const groups: { label: string; rows: Item[] }[] = []
  for (const it of items) {
    const label = dayLabel(it.at)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.rows.push(it)
    else groups.push({ label, rows: [it] })
  }

  return (
    <div className="pb-6">
      <header className="px-4 pb-3" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <Link to="/more" className="inline-flex items-center gap-1 min-h-11 text-brand text-sm no-underline"><ArrowLeft size={18} /> Ещё</Link>
        <h1 className="text-[22px] leading-7 font-semibold text-ink">История</h1>
        <p className="text-ink-secondary text-sm mt-1">Только операции, подтверждённые сервером</p>
        {fromCache && cachedAt > 0 && <p className="text-xs text-ink-secondary mt-1">Сохранённая копия на {fmtClock(cachedAt)}</p>}
      </header>
      <div className="p-4 space-y-3">
        {error && <p className="rounded-xl bg-warn-bg p-3 text-sm text-warn">{error}</p>}
        {!items.length && !busy && !error && (
          <div className="card text-center py-8">
            <b>Пока нет подтверждённых операций</b>
            <p className="text-ink-secondary text-sm mt-2">Покупки и начисления появятся после обработки кассой.</p>
          </div>
        )}
        {groups.map((g) => (
          <section key={g.label} className="space-y-2">
            <h2 className="text-[12px] leading-4 font-semibold tracking-wide text-ink-secondary px-1">{g.label}</h2>
            {g.rows.map((i) => (
              <article key={i.id} className="card !mb-0 flex gap-3 items-start">
                <div className="min-w-0 flex-1">
                  <b className="text-sm text-ink">{i.title}</b>
                  <p className="text-xs text-ink-secondary mt-1">
                    {new Date(i.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                    {i.cupsDelta !== 0 && ` · ${i.cupsDelta > 0 ? '+' : '−'}${Math.abs(i.cupsDelta)} ${cupsWord(Math.abs(i.cupsDelta))}`}
                  </p>
                </div>
                <div
                  className={
                    'text-right text-[15px] font-display font-semibold num ' +
                    (i.cashbackDeltaKop < 0 ? 'text-bad' : 'text-ink')
                  }
                >
                  {amountOf(i)}
                </div>
              </article>
            ))}
          </section>
        ))}
        <button type="button" className="btn-ghost min-h-12 w-full flex justify-center items-center gap-2" disabled={busy} onClick={() => void load(null)}>
          <RefreshCw size={16} className={busy ? 'animate-spin motion-reduce:animate-none' : ''} /> Обновить
        </button>
        {cursor && <button type="button" className="btn min-h-12" disabled={busy} onClick={() => void load(cursor, true)}>Показать ещё</button>}
      </div>
    </div>
  )
}

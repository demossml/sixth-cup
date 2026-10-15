import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppIcon, ChevronRight, Store, X, Gift, WifiOff, RefreshCw } from '../lib/icons'
import { useApp } from '../lib/app'
import type { Directory } from '../lib/types'

type Product = Directory['products'][number]

function ProductPhoto({ product, large = false }: { product: Product; large?: boolean }) {
  const [failed, setFailed] = useState(false)
  const size = large ? 'aspect-[4/3]' : 'aspect-square'
  if (product.imageUrl && !failed) {
    return <img src={product.imageUrl} alt={product.name} loading="lazy" onError={() => setFailed(true)} className={`${size} w-full object-cover bg-[#EDE7DC]`} />
  }
  return (
    <div className={`${size} w-full bg-[linear-gradient(145deg,#EEE7DA,#DCD0BC)] flex items-center justify-center relative overflow-hidden`} aria-label={`Фото ${product.name} пока нет`}>
      <div className="absolute inset-3 rounded-xl border border-white/60" />
      <div className="relative flex flex-col items-center gap-1 text-brand/75">
        <AppIcon name={product.icon} size={large ? 42 : 30} />
        <span className="font-display text-[11px] tracking-[0.2em] font-semibold">6.7</span>
      </div>
    </div>
  )
}

export default function MenuPage() {
  const { dir, sync, syncing } = useApp()
  const nav = useNavigate()
  const [catId, setCatId] = useState<number | 'all'>('all')
  const [selected, setSelected] = useState<Product | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)

  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline) }
  }, [])
  useEffect(() => {
    if (selected) {
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null) }
      window.addEventListener('keydown', onKey)
      document.body.style.overflow = 'hidden'
      return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
    }
  }, [selected])

  const categories = dir?.categories ?? []
  const products = useMemo(() => {
    if (!dir) return []
    const list = [...dir.products].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    return catId === 'all' ? list : list.filter((p) => p.categoryId === catId)
  }, [dir, catId])
  const stale = !!dir?.generatedAt && Date.now() - dir.generatedAt > 5 * 60_000

  async function refreshCatalog() {
    setLoadError(false)
    const result = await sync()
    if (result === 'offline' || result === 'error') setLoadError(true)
  }

  if (!dir) {
    return (
      <main className="px-4 pb-6" style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))' }}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand mb-1">6.7 Coffee</p>
        <h1 className="text-[28px] leading-8 font-semibold text-ink mb-2">Меню</h1>
        <div className="rounded-3xl bg-white border border-line p-5 mt-5">
          <div className="w-12 h-12 rounded-2xl bg-brand-tint text-brand flex items-center justify-center mb-4"><WifiOff size={22} strokeWidth={1.75} /></div>
          <h2 className="font-display text-lg font-semibold text-ink mb-1">{online ? 'Каталог пока не загружен' : 'Нет подключения к сети'}</h2>
          <p className="text-sm text-ink-secondary mb-4">{online ? 'Обновите данные, чтобы открыть витрину напитков и десертов.' : 'Когда появится сеть, меню загрузится автоматически. Карта лояльности находится во вкладке «Карта».'}</p>
          <button type="button" onClick={() => void refreshCatalog()} disabled={syncing || !online} className="btn min-h-11 inline-flex items-center justify-center gap-2 disabled:opacity-50"><RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />{syncing ? 'Обновляем' : 'Повторить загрузку'}</button>
          {loadError && <p role="alert" className="text-sm text-bad mt-3">Не удалось загрузить каталог. Попробуйте ещё раз позже.</p>}
        </div>
      </main>
    )
  }

  const chip = (active: boolean) => `shrink-0 px-4 min-h-9 rounded-full text-[13px] font-semibold transition-colors ${active ? 'bg-brand text-white' : 'bg-white text-ink-secondary border border-line active:bg-brand-tint'}`

  return (
    <main className="pb-5">
      <header className="px-4 pb-2" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <h1 className="text-[24px] leading-8 font-semibold text-ink">Меню</h1>
      </header>

      <div className="sticky top-0 z-20 bg-page/95 backdrop-blur-sm px-4 pt-1 pb-3">
        <div className="flex gap-2 overflow-x-auto scrollbar-none" aria-label="Категории меню">
          <button type="button" onClick={() => setCatId('all')} aria-pressed={catId === 'all'} className={chip(catId === 'all')}>Все</button>
          {categories.map((c) => <button key={c.id} type="button" onClick={() => setCatId(c.id)} aria-pressed={catId === c.id} className={chip(catId === c.id)}>{c.name}</button>)}
        </div>
      </div>

      {products.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-4 px-4">
          {products.map((p) => (
            <button key={p.id} type="button" onClick={() => setSelected(p)} className="text-left min-w-0 active:scale-[0.98] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-2xl">
              <div className="rounded-2xl overflow-hidden"><ProductPhoto product={p} /></div>
              <div className="px-0.5 pt-2">
                <div className="text-[13px] leading-[17px] font-medium text-ink line-clamp-2">{p.name}</div>
                <div className="font-display text-[14px] leading-5 font-semibold num text-ink-secondary mt-0.5">{Math.round(p.price).toLocaleString('ru-RU')} ₽</div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="mx-4 rounded-3xl bg-white border border-line p-6 text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-brand-tint text-brand flex items-center justify-center mb-3"><AppIcon name="Coffee" size={26} /></div>
          <h2 className="font-display text-lg font-semibold text-ink">Скоро обновим меню</h2>
          <p className="text-sm text-ink-secondary mt-1">В этой категории пока нет позиций.</p>
          {catId !== 'all' && <button type="button" onClick={() => setCatId('all')} className="text-brand font-semibold text-sm mt-3 min-h-11 px-3">Показать всё меню</button>}
        </div>
      )}
      <p className="text-[12px] leading-[18px] text-ink-secondary text-center mt-5 px-4">Заказ и оплата — на кассе{dir.generatedAt > 0 ? ` · ${stale ? 'каталог может быть устаревшим' : 'меню обновлено'} ${new Date(dir.generatedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : ''}</p>

      {selected && (
        <div className="fixed inset-0 z-50 bg-white overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="product-sheet-title">
          <div className="max-w-[480px] mx-auto min-h-full flex flex-col animate-[sheet-up_220ms_ease-out]">
            <div className="relative">
              <div className="max-h-[52dvh] overflow-hidden"><ProductPhoto product={selected} large /></div>
              <button type="button" onClick={() => setSelected(null)} aria-label="Закрыть карточку товара" className="absolute left-3 w-11 h-11 rounded-full bg-black/35 backdrop-blur-sm flex items-center justify-center text-white" style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }}><X size={22} strokeWidth={1.75} /></button>
            </div>
            <div className="px-5 pt-5 flex-1">
              <h2 id="product-sheet-title" className="font-display text-[22px] leading-7 font-semibold text-ink">{selected.name}</h2>
              <p className="font-display text-[26px] leading-8 font-semibold num text-ink mt-1">{Math.round(selected.price).toLocaleString('ru-RU')} ₽</p>
              {selected.description && <p className="text-[15px] leading-[22px] text-ink-secondary mt-3">{selected.description}</p>}
              {selected.freeEligible && <div className="inline-flex items-center gap-2 rounded-full bg-[#F1E6D6] text-[#78572F] px-3 py-2 text-[12px] font-semibold mt-4"><Gift size={15} />Участвует в подарке</div>}
              <p className="text-[13px] leading-[18px] text-ink-secondary mt-4">Заказ и оплата — у бариста. В приложении нет корзины и онлайн-оплаты.</p>
            </div>
            <div className="px-5 pt-4" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
              <button type="button" onClick={() => { setSelected(null); nav('/') }} className="btn min-h-12">На кассе покажите карту</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

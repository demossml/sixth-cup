import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppIcon, X, Gift, WifiOff, RefreshCw } from '../lib/icons'
import { useApp } from '../lib/app'
import { mediaUrl } from '../lib/media'
import type { Directory } from '../lib/types'

type Product = Directory['products'][number]

/** Photo or warm 6.7 placeholder — styleboard. */
function ProductPhoto({ product, large = false }: { product: Product; large?: boolean }) {
  const [failed, setFailed] = useState(false)
  const src = mediaUrl(product.imageUrl)
  const size = large ? 'aspect-[4/3]' : 'aspect-square'
  if (src && !failed) {
    return (
      <img
        src={src}
        alt={product.name}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={`${size} w-full object-cover bg-[#EDE7DC]`}
      />
    )
  }
  return (
    <div
      className={`${size} w-full bg-[linear-gradient(145deg,#EEE7DA,#DCD0BC)] flex items-center justify-center relative overflow-hidden`}
      aria-label={`Фото ${product.name} пока нет`}
    >
      <div className="absolute inset-3 rounded-xl border border-white/55" />
      <div className="relative flex flex-col items-center gap-1 text-brand/70">
        <AppIcon name={product.icon} size={large ? 42 : 28} />
        <span className="font-display text-[11px] tracking-[0.18em] font-semibold">6.7</span>
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
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [selected])

  const categories = dir?.categories ?? []
  const stores = dir?.stores ?? []
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

  const chip = (active: boolean) =>
    `shrink-0 px-4 min-h-9 rounded-full text-[13px] font-semibold transition-colors ${
      active ? 'bg-brand text-white' : 'bg-white text-ink-secondary border border-line active:bg-brand-tint'
    }`

  /* ——— empty directory / offline ——— */
  if (!dir) {
    return (
      <main className="px-4 pb-6" style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))' }}>
        <h1 className="text-[28px] leading-8 font-semibold text-ink mb-4">Меню</h1>
        <div className="rounded-3xl bg-white border border-line p-6 text-center shadow-card">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-brand-tint text-brand flex items-center justify-center mb-4">
            {online ? <RefreshCw size={22} strokeWidth={1.75} /> : <WifiOff size={22} strokeWidth={1.75} />}
          </div>
          <h2 className="font-display text-lg font-semibold text-ink">
            {online ? 'Не удалось загрузить меню' : 'Нет соединения'}
          </h2>
          <p className="text-sm text-ink-secondary mt-2 mb-4">
            {online
              ? 'Проверьте соединение и попробуйте ещё раз.'
              : 'Когда появится сеть, меню загрузится. Карта доступна во вкладке «Карта».'}
          </p>
          <button
            type="button"
            onClick={() => void refreshCatalog()}
            disabled={syncing || !online}
            className="btn min-h-11 inline-flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <RefreshCw size={16} className={syncing ? 'animate-spin motion-reduce:animate-none' : ''} />
            {syncing ? 'Обновляем…' : 'Повторить'}
          </button>
          {loadError && (
            <p role="alert" className="text-sm text-bad mt-3">
              Ошибка загрузки каталога.
            </p>
          )}
        </div>
      </main>
    )
  }

  return (
    <main className="pb-5">
      <header className="px-4 pb-1" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <h1 className="text-[28px] leading-8 font-semibold text-ink">Меню</h1>
        {stores.length > 0 && (
          <p className="mt-1 text-[13px] text-ink-secondary truncate">
            {stores[0].name}
            {stale ? ' · каталог может быть устаревшим' : ''}
          </p>
        )}
      </header>

      {/* Category chips — styleboard */}
      <div className="sticky top-0 z-20 bg-page/95 backdrop-blur-sm px-4 pt-2 pb-3">
        <div className="flex gap-2 overflow-x-auto scrollbar-none" aria-label="Категории меню">
          <button type="button" onClick={() => setCatId('all')} aria-pressed={catId === 'all'} className={chip(catId === 'all')}>
            Все
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCatId(c.id)}
              aria-pressed={catId === c.id}
              className={chip(catId === c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {products.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 px-4">
          {products.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelected(p)}
              className="text-left min-w-0 rounded-2xl overflow-hidden bg-white border border-line/80 shadow-card active:scale-[0.98] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <ProductPhoto product={p} />
              <div className="px-2.5 py-2.5">
                <div className="text-[13px] leading-[17px] font-medium text-ink line-clamp-2 min-h-[34px]">{p.name}</div>
                <div className="font-display text-[15px] leading-5 font-semibold num text-ink mt-1">
                  {Math.round(p.price).toLocaleString('ru-RU')} ₽
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="mx-4 rounded-3xl bg-white border border-line p-6 text-center shadow-card">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-brand-tint text-brand flex items-center justify-center mb-3">
            <AppIcon name="Coffee" size={26} />
          </div>
          <h2 className="font-display text-lg font-semibold text-ink">Скоро обновим меню</h2>
          <p className="text-sm text-ink-secondary mt-1">Пока здесь нет товаров.</p>
          {catId !== 'all' && (
            <button type="button" onClick={() => setCatId('all')} className="btn mt-4 min-h-11">
              Хорошо · всё меню
            </button>
          )}
        </div>
      )}

      <p className="text-[12px] leading-[18px] text-ink-secondary text-center mt-5 px-4">
        Заказ и оплата — на кассе
        {dir.generatedAt > 0
          ? ` · данные на ${new Date(dir.generatedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
          : ''}
      </p>

      {/* Product sheet — styleboard: photo, title, price, gift badge, CTA to card */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/45"
          role="presentation"
          onClick={() => setSelected(null)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-sheet-title"
            className="relative w-full max-w-[480px] mx-auto max-h-[92dvh] overflow-y-auto rounded-t-[28px] bg-page shadow-2xl animate-[sheet-up_220ms_ease-out]"
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative">
              <ProductPhoto product={selected} large />
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Закрыть"
                className="absolute right-3 w-10 h-10 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white"
                style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }}
              >
                <X size={20} strokeWidth={1.75} />
              </button>
            </div>
            <div className="px-5 pt-4">
              <div className="flex items-start justify-between gap-3">
                <h2 id="product-sheet-title" className="font-display text-[22px] leading-7 font-semibold text-ink">
                  {selected.name}
                </h2>
                <span className="font-display text-[22px] leading-7 font-semibold num text-ink whitespace-nowrap">
                  {Math.round(selected.price).toLocaleString('ru-RU')} ₽
                </span>
              </div>
              {selected.description ? (
                <p className="text-[15px] leading-[22px] text-ink-secondary mt-2">{selected.description}</p>
              ) : null}
              {selected.freeEligible ? (
                <div className="inline-flex items-center gap-2 rounded-full bg-[#F1E6D6] text-[#78572F] px-3 py-2 text-[12px] font-semibold mt-3">
                  <Gift size={15} strokeWidth={1.75} />
                  Участвует в подарке
                </div>
              ) : null}
              <p className="text-[13px] leading-[18px] text-ink-secondary mt-4">
                Заказ и оплата — у бариста. В приложении нет корзины.
              </p>
            </div>
            <div className="px-5 pt-4 pb-2">
              <button
                type="button"
                onClick={() => {
                  setSelected(null)
                  nav('/')
                }}
                className="btn min-h-12"
              >
                На кассе покажите карту
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

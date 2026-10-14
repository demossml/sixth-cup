import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ProductThumb from '../components/ProductThumb'
import { useApp } from '../lib/app'
import { Gift, Store, X } from '../lib/icons'
import { mediaUrl } from '../lib/media'

type Product = {
  id: number
  name: string
  price: number
  description?: string | null
  categoryId?: number | null
  imageUrl?: string | null
  sortOrder?: number
  freeEligible?: boolean
}

/**
 * Меню = витрина 2 колонки с фото.
 * Тап → sheet: крупное фото, описание, бейдж подарка.
 * Заказ и оплата только на кассе — без корзины и «добавить».
 */
export default function MenuPage() {
  const { dir } = useApp()
  const nav = useNavigate()
  const [catId, setCatId] = useState<number | 'all'>('all')
  const [selected, setSelected] = useState<Product | null>(null)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    setNow(Date.now())
  }, [dir?.generatedAt])
  const stale = !!dir?.generatedAt && now - dir.generatedAt > 5 * 60_000

  const categories = dir?.categories ?? []
  const products = useMemo(() => {
    if (!dir) return [] as Product[]
    const list = [...dir.products].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)) as Product[]
    if (catId === 'all') return list
    return list.filter((p) => p.categoryId === catId)
  }, [dir, catId])

  if (!dir) {
    return (
      <div className="px-4" style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))' }}>
        <h1 className="text-[22px] leading-7 font-semibold text-ink mb-2">Меню</h1>
        <p className="text-ink-secondary text-[15px]">Меню появится после первой синхронизации.</p>
      </div>
    )
  }

  const chip = (active: boolean) =>
    `shrink-0 px-4 min-h-11 rounded-full text-[14px] font-semibold ${
      active ? 'bg-brand text-white' : 'bg-white text-ink-secondary border border-line'
    }`

  return (
    <div className="pb-4">
      <header className="px-4 pb-3" style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))' }}>
        <h1 className="text-[22px] leading-7 font-semibold text-ink">Меню</h1>
        {dir.generatedAt > 0 && (
          <p className="text-[13px] leading-[18px] text-ink-secondary mt-1 num">
            {stale ? 'Каталог может быть устаревшим · данные на ' : 'Данные каталога на '}
            {new Date(dir.generatedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
      </header>

      <div className="px-4">
        {dir.stores.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-2">
            {dir.stores.map((s) => (
              <div
                key={s.id}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-brand-tint text-brand text-[12px] leading-4 font-semibold"
              >
                <Store size={12} strokeWidth={1.75} />
                {s.name}
              </div>
            ))}
          </div>
        )}

        {categories.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-3 -mx-1 px-1">
            <button type="button" onClick={() => setCatId('all')} className={chip(catId === 'all')}>
              Все
            </button>
            {categories.map((c) => (
              <button key={c.id} type="button" onClick={() => setCatId(c.id)} className={chip(catId === c.id)}>
                {c.name}
              </button>
            ))}
          </div>
        )}

        {/* Витрина 2 колонки */}
        <div className="grid grid-cols-2 gap-3">
          {products.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelected(p)}
              className="text-left rounded-2xl bg-white border border-line overflow-hidden shadow-card active:opacity-90"
            >
              <div className="aspect-square bg-[#EDE7DC]">
                <ProductThumb imageUrl={p.imageUrl} className="w-full h-full rounded-none" alt="" />
              </div>
              <div className="p-2.5">
                <div className="font-semibold text-ink text-[13px] leading-5 line-clamp-2 min-h-[2.5rem]">{p.name}</div>
                <div className="mt-1 font-display font-semibold text-ink text-[15px] num">{p.price} ₽</div>
              </div>
            </button>
          ))}
        </div>

        {products.length === 0 && (
          <p className="text-ink-secondary text-sm text-center py-10">Скоро обновим меню</p>
        )}

        <p className="text-[13px] leading-[18px] text-ink-secondary text-center mt-5">Заказ и оплата — на кассе</p>
      </div>

      {/* Sheet просмотра товара — без корзины */}
      {selected && (
        <ProductSheet
          product={selected}
          onClose={() => setSelected(null)}
          onShowCard={() => {
            setSelected(null)
            nav('/')
          }}
        />
      )}
    </div>
  )
}

function ProductSheet({
  product,
  onClose,
  onShowCard,
}: {
  product: Product
  onClose: () => void
  onShowCard: () => void
}) {
  const src = mediaUrl(product.imageUrl)

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={product.name}>
      <button type="button" className="absolute inset-0 bg-black/45 border-0 cursor-default" aria-label="Закрыть" onClick={onClose} />
      <div
        className="relative z-10 max-w-[480px] mx-auto w-full bg-white rounded-t-3xl shadow-lift overflow-hidden flex flex-col max-h-[92vh]"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <div className="relative aspect-[4/3] bg-[#EDE7DC] shrink-0">
          {src ? (
            <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-brand/30 text-lg font-semibold tracking-wide">6.7</div>
          )}
          <button
            type="button"
            onClick={onClose}
            className="absolute top-3 right-3 w-10 h-10 rounded-full bg-white/90 text-ink flex items-center justify-center shadow-card"
            aria-label="Закрыть"
          >
            <X size={20} strokeWidth={1.75} />
          </button>
        </div>

        <div className="px-4 pt-4 pb-2 overflow-y-auto">
          {product.freeEligible ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-brand bg-brand-tint rounded-full px-2 py-0.5 mb-2">
              <Gift size={12} strokeWidth={1.75} /> Участвует в подарке
            </span>
          ) : null}
          <h2 className="font-display font-semibold text-[22px] leading-7 text-ink">{product.name}</h2>
          <p className="mt-1 font-display font-semibold text-[20px] text-ink num">{product.price} ₽</p>
          {product.description ? (
            <p className="mt-3 text-[15px] leading-6 text-ink-secondary whitespace-pre-line">{product.description}</p>
          ) : null}
        </div>

        <div className="px-4 pt-3 space-y-2 shrink-0">
          <button type="button" className="btn min-h-12" onClick={onShowCard}>
            На кассе покажите карту
          </button>
          <button type="button" className="btn-ghost min-h-11 w-full" onClick={onClose}>
            Закрыть
          </button>
          <p className="text-center text-[12px] leading-4 text-ink-tertiary pb-1">Заказ и оплата — у бариста</p>
        </div>
      </div>
    </div>
  )
}

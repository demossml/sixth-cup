import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../lib/app'
import { AppIcon, Store } from '../lib/icons'

/**
 * Меню — только просмотр (заказ и оплата на кассе: без «+», корзины и кнопок заказа).
 * Строки-карточки с миниатюрой 72 px. Если фото есть меньше чем у половины позиций,
 * миниатюры скрываются у всех (текст-первый список) — без пустых серых квадратов.
 */
export default function MenuPage() {
  const { dir } = useApp()
  const [catId, setCatId] = useState<number | 'all'>('all')
  const [now, setNow] = useState(Date.now())
  useEffect(() => { setNow(Date.now()) }, [dir?.generatedAt])
  const stale = !!dir?.generatedAt && now - dir.generatedAt > 5 * 60_000

  const categories = dir?.categories ?? []
  const products = useMemo(() => {
    if (!dir) return []
    const list = [...dir.products].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    if (catId === 'all') return list
    return list.filter((p) => p.categoryId === catId)
  }, [dir, catId])
  const showThumbs = useMemo(() => {
    const all = dir?.products ?? []
    if (all.length === 0) return false
    return all.filter((p) => !!p.imageUrl).length * 2 >= all.length
  }, [dir])

  if (!dir) {
    return (
      <div className="px-4" style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))' }}>
        <h1 className="text-[22px] leading-7 font-semibold text-ink mb-2">Меню</h1>
        <p className="text-ink-secondary text-[15px]">Меню появится после первой синхронизации.</p>
      </div>
    )
  }

  const chip = (active: boolean) =>
    `shrink-0 px-4 min-h-11 rounded-full text-[14px] font-semibold ${active ? 'bg-brand text-white' : 'bg-white text-ink-secondary border border-line'}`

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
              <div key={s.id} className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-brand-tint text-brand text-[12px] leading-4 font-semibold">
                <Store size={12} strokeWidth={1.75} />
                {s.name}
              </div>
            ))}
          </div>
        )}

        {categories.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-3">
            <button type="button" onClick={() => setCatId('all')} className={chip(catId === 'all')}>Все</button>
            {categories.map((c) => (
              <button key={c.id} type="button" onClick={() => setCatId(c.id)} className={chip(catId === c.id)}>{c.name}</button>
            ))}
          </div>
        )}

        <div className="space-y-2">
          {products.map((p) => (
            <div key={p.id} className="bg-white border border-line rounded-2xl shadow-card p-3 flex items-center gap-3">
              {showThumbs && (
                p.imageUrl ? (
                  <img src={p.imageUrl} alt="" loading="lazy" className="w-[72px] h-[72px] rounded-xl object-cover shrink-0 bg-[#EDE7DC]" />
                ) : (
                  <div className="w-[72px] h-[72px] rounded-xl shrink-0 bg-[#EDE7DC] flex items-center justify-center">
                    <AppIcon name={p.icon} size={26} className="text-brand/40" />
                  </div>
                )
              )}
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-ink text-base leading-[22px]">{p.name}</div>
                {p.description && <div className="text-ink-secondary text-[13px] leading-[18px] mt-0.5 line-clamp-2">{p.description}</div>}
              </div>
              <div className="font-display font-semibold text-ink text-base num shrink-0">{p.price} ₽</div>
            </div>
          ))}
        </div>
        {products.length === 0 && (
          <p className="text-ink-secondary text-sm text-center py-8">Пока нет позиций</p>
        )}
        <p className="text-[13px] leading-[18px] text-ink-secondary text-center mt-4">Заказ и оплата — на кассе</p>
      </div>
    </div>
  )
}

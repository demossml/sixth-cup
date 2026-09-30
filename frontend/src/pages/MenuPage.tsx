import { useMemo, useState } from 'react'
import { useApp } from '../lib/app'
import { AppIcon, Store } from '../lib/icons'

export default function MenuPage() {
  const { dir } = useApp()
  const [catId, setCatId] = useState<number | 'all'>('all')

  const categories = dir?.categories ?? []
  const products = useMemo(() => {
    if (!dir) return []
    const list = [...dir.products].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    if (catId === 'all') return list
    return list.filter((p) => p.categoryId === catId)
  }, [dir, catId])

  if (!dir) {
    return (
      <div className="p-4">
        <h1 className="text-xl font-bold text-ink mb-2">Меню</h1>
        <p className="text-ink-secondary text-sm">Меню появится после первой синхронизации.</p>
      </div>
    )
  }

  return (
    <div className="pb-4">
      <div className="bg-white px-4 pt-10 pb-4 border-b border-line">
        <h1 className="text-xl font-bold text-ink">Меню</h1>
        <p className="text-ink-secondary text-sm mt-1">
          Заказ и оплата у бариста. Карта — для скидок и стаканов.
        </p>
      </div>

      <div className="px-4 pt-3">
        {dir.stores.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-2 mb-2">
            {dir.stores.map((s) => (
              <div key={s.id} className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-brand-soft text-brand text-xs font-medium">
                <Store size={12} />
                {s.name}
              </div>
            ))}
          </div>
        )}

        {categories.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-3">
            <button
              type="button"
              onClick={() => setCatId('all')}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium ${
                catId === 'all' ? 'bg-brand text-white' : 'bg-white text-ink-secondary border border-line'
              }`}
            >
              Все
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCatId(c.id)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium ${
                  catId === c.id ? 'bg-brand text-white' : 'bg-white text-ink-secondary border border-line'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          {products.map((p) => (
            <div key={p.id} className="card !mb-0 flex flex-col items-start">
              {p.imageUrl ? (
                <img src={p.imageUrl} alt="" className="w-full h-24 rounded-xl object-cover mb-2.5 bg-brand-soft" />
              ) : (
                <div className="w-12 h-12 rounded-xl bg-brand-soft flex items-center justify-center mb-2.5">
                  <AppIcon name={p.icon} size={22} className="text-brand" />
                </div>
              )}
              <div className="font-semibold text-ink text-sm leading-tight">{p.name}</div>
              {p.description && (
                <div className="text-ink-tertiary text-xs mt-0.5 line-clamp-2">{p.description}</div>
              )}
              <div className="text-brand font-bold text-sm mt-1.5">{p.price} ₽</div>
            </div>
          ))}
        </div>
        {products.length === 0 && (
          <p className="text-ink-tertiary text-sm text-center py-8">Пока нет позиций</p>
        )}
      </div>
    </div>
  )
}

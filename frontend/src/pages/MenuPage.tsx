import { useApp } from '../lib/app'
import { AppIcon, Store } from '../lib/icons'

export default function MenuPage() {
  const { dir } = useApp()

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

        <div className="grid grid-cols-2 gap-2.5">
          {dir.products.map((p) => (
            <div key={p.id} className="card !mb-0 flex flex-col items-start">
              <div className="w-12 h-12 rounded-xl bg-brand-soft flex items-center justify-center mb-2.5">
                <AppIcon name={p.icon || 'Coffee'} size={24} className="text-brand" />
              </div>
              <b className="text-sm text-ink leading-snug">{p.name}</b>
              <div className="text-brand font-bold text-base mt-1">{p.price} ₽</div>
            </div>
          ))}
        </div>

        {dir.products.length === 0 && (
          <p className="text-ink-tertiary text-sm text-center py-8">Пока нет позиций</p>
        )}
      </div>
    </div>
  )
}

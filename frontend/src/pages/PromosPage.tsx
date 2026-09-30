import { useApp } from '../lib/app'
import { AppIcon } from '../lib/icons'

export default function PromosPage() {
  const { dir } = useApp()
  return (
    <div className="pb-4">
      <div className="bg-white px-4 pt-10 pb-4 border-b border-line">
        <h1 className="text-xl font-bold text-ink">Акции</h1>
        <p className="text-ink-secondary text-sm mt-1">Новинки и предложения</p>
      </div>

      <div className="px-4 pt-3">
        {!dir && <p className="text-ink-secondary text-sm">Акции загрузятся при первом подключении.</p>}
        {dir?.promos.map((p) => (
          <div key={p.id} className="card flex gap-3">
            <div className="w-11 h-11 rounded-xl bg-brand-soft flex items-center justify-center shrink-0">
              <AppIcon name={p.icon || 'Sparkles'} size={22} className="text-brand" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <b className="text-sm text-ink">{p.title}</b>
                {p.sponsor && (
                  <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-accent-orange/10 text-accent-orange font-medium">реклама</span>
                )}
              </div>
              <div className="text-ink-secondary text-xs mt-1 leading-relaxed">{p.body}</div>
              {p.sponsor && <div className="text-ink-tertiary text-xs mt-1">Партнёр: {p.sponsor}</div>}
              <div className="text-ink-tertiary text-xs mt-1">до {new Date(p.endsAt * 1000).toLocaleDateString()}</div>
            </div>
          </div>
        ))}
        {dir && dir.promos.length === 0 && (
          <p className="text-ink-tertiary text-sm text-center py-8">Сейчас акций нет</p>
        )}
      </div>
    </div>
  )
}

import { useNavigate } from 'react-router-dom'
import { useApp } from '../lib/app'
import { AppIcon } from '../lib/icons'

function isInvitePromo(title: string, body: string) {
  return /друг|приглас|реферал|3\s*%|кэшбэк от/i.test(title + ' ' + body)
}

export default function PromosPage() {
  const { dir } = useApp()
  const nav = useNavigate()
  return (
    <div className="pb-4">
      <div className="bg-white px-4 pt-10 pb-4 border-b border-line">
        <h1 className="text-xl font-bold text-ink">Акции</h1>
        <p className="text-ink-secondary text-sm mt-1">Новинки и предложения</p>
      </div>

      <div className="px-4 pt-3 space-y-2">
        {!dir && <p className="text-ink-secondary text-sm">Акции загрузятся при первом подключении.</p>}

        <button
          type="button"
          className="card w-full flex gap-3 items-center text-left border-brand/20"
          onClick={() => nav('/invite')}
        >
          <div className="w-11 h-11 rounded-xl bg-brand-soft flex items-center justify-center shrink-0">
            <AppIcon name="Users" size={22} className="text-brand" />
          </div>
          <div className="min-w-0 flex-1">
            <b className="text-sm text-ink">Приведи друга</b>
            <div className="text-ink-secondary text-xs mt-0.5">
              Нажмите — QR для друга и условия {dir?.referralCashbackPercent ?? 3}% кэшбэка
            </div>
          </div>
          <span className="text-brand">›</span>
        </button>

        {dir?.promos.map((p) => {
          const invite = isInvitePromo(p.title, p.body)
          const inner = (
            <>
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
                {invite && <div className="text-brand text-xs font-medium mt-1">Открыть QR приглашения →</div>}
                {p.sponsor && <div className="text-ink-tertiary text-xs mt-1">Партнёр: {p.sponsor}</div>}
                <div className="text-ink-tertiary text-xs mt-1">до {new Date(p.endsAt * 1000).toLocaleDateString()}</div>
              </div>
            </>
          )
          return invite ? (
            <button key={p.id} type="button" className="card w-full flex gap-3 text-left" onClick={() => nav('/invite')}>
              {inner}
            </button>
          ) : (
            <div key={p.id} className="card flex gap-3">{inner}</div>
          )
        })}
        {dir && dir.promos.length === 0 && (
          <p className="text-ink-tertiary text-sm text-center py-6">Других акций пока нет</p>
        )}
      </div>
    </div>
  )
}

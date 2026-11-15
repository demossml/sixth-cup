import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../lib/app'
import { AppIcon } from '../lib/icons'
import { promoStatus } from '../lib/promoStatus'
import { promoText } from '../lib/promoText'

/**
 * Список акций. Раньше здесь показывались все акции без учёта расписания и с чужой
 * подписью «Открыть QR приглашения →» (эвристика по слову «друг» ловила «другими акциями»).
 *
 * Теперь:
 *  • статус считается тем же `isVisibleAt`, что и на главной (офлайн, по часам телефона);
 *  • «Начнётся в 17:00» / «Завершилась в 12:00» вместо молчаливого показа;
 *  • сверху действующие, ниже будущие, последними завершившиеся;
 *  • текст карточки разбирается: заголовок + описание без «Условий».
 */
export default function PromosPage() {
  const { dir } = useApp()
  const nav = useNavigate()

  const items = useMemo(() => {
    const now = new Date()
    return (dir?.promos ?? [])
      .map((p) => ({ p, status: promoStatus(p, now), text: promoText(p) }))
      .sort((a, b) => {
        const rank = (x: { status: { visible: boolean; upcoming: boolean } }) =>
          x.status.visible ? 0 : x.status.upcoming ? 1 : 2
        return rank(a) - rank(b)
      })
  }, [dir])

  return (
    <div className="pb-4">
      <div className="px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-3">
        <h1 className="text-[22px] leading-7 font-semibold text-ink">Акции</h1>
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
            <b className="text-sm text-ink">Пригласить друга</b>
            <div className="text-ink-secondary text-xs mt-0.5">
              Нажмите — QR для друга и условия {dir?.referralCashbackPercent ?? 3}% кэшбэка
            </div>
          </div>
          <span className="text-brand">›</span>
        </button>

        {items.map(({ p, status, text }) => (
          <button
            key={p.id}
            type="button"
            className={`card w-full flex gap-3 text-left ${status.visible ? '' : 'opacity-70'}`}
            onClick={() => nav(`/promo/${p.id}`)}
          >
            <div className="w-11 h-11 rounded-xl bg-brand-soft flex items-center justify-center shrink-0">
              <AppIcon name={p.icon || 'Sparkles'} size={22} className="text-brand" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <b className="text-sm text-ink">{text.title}</b>
                {p.sponsor && (
                  <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-warn-bg text-warn font-medium">
                    реклама
                  </span>
                )}
              </div>
              {text.lead ? (
                <div className="text-ink-secondary text-xs mt-1 leading-relaxed">{text.lead}</div>
              ) : null}
              <div
                className={`text-xs mt-1 font-medium ${
                  status.visible ? 'text-ok' : status.upcoming ? 'text-brand' : 'text-ink-tertiary'
                }`}
              >
                {status.label}
              </div>
              {p.sponsor && <div className="text-ink-tertiary text-xs mt-1">Партнёр: {p.sponsor}</div>}
            </div>
          </button>
        ))}

        {dir && dir.promos.length === 0 && (
          <p className="text-ink-tertiary text-sm text-center py-6">Других акций пока нет</p>
        )}
      </div>
    </div>
  )
}

import { ChevronRight } from '../../lib/icons'
import { formatRub } from '../../lib/money'
import { bannerState } from '../../lib/orderBanner'
import { useNow } from '../../lib/useNow'
import type { OrderOut } from '../../lib/preorderApi'

/**
 * Баннер активного заказа для главной и меню.
 *
 * Показывает ровно три вещи: что заказ есть, на каком он этапе и через сколько будет готов.
 * Пустых слотов нет: без активного заказа компонент не рендерится вообще, поэтому
 * вёрстка главного экрана не сдвигается.
 *
 * variant="floating" — пилюля над таб-баром (главная): статус всегда на виду, но
 * не занимает место в потоке. variant="inline" — карточка в списке (меню, меню заказа).
 */
const STEPS = ['draft', 'accepted', 'cooking', 'ready'] as const

type Props = {
  order: OrderOut | null
  storeName?: string | null
  offline?: boolean
  now?: number
  variant?: 'inline' | 'floating'
  onOpen: (order: OrderOut) => void
}

export default function ActiveOrderBanner({ order, storeName, offline, now: fixedNow, variant = 'inline', onOpen }: Props) {
  const tick = useNow(1000)
  if (!order) return null
  const s = bannerState(order, fixedNow ?? tick)
  const filledIndex = order.status === 'paid' ? STEPS.length : s.filled

  // Плавающая пилюля: одна строка статуса + короткая подпись, высота ~52 px.
  if (variant === 'floating') {
    return (
      <div
        className="fixed left-0 right-0 z-30 flex justify-center px-3 pointer-events-none"
        style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom, 0px) + 0.5rem)' }}
      >
        <button
          type="button"
          onClick={() => onOpen(order)}
          aria-label={`Заказ ${order.shortCode}, ${s.label}`}
          className={`pointer-events-auto w-full max-w-[456px] text-left rounded-full border pl-3 pr-2 py-2 flex items-center gap-2.5 shadow-lift active:opacity-95 motion-reduce:transition-none ${
            s.accent ? 'bg-brand text-white border-brand' : 'bg-white border-line text-ink'
          }`}
        >
          <span
            className={`w-2.5 h-2.5 flex-none rounded-full ${s.accent ? 'bg-white' : 'bg-brand'}`}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1">
            <span className={`block text-[13px] leading-4 font-semibold ${s.accent ? 'text-white' : 'text-ink'}`}>
              {s.label}
            </span>
            <span className={`block text-[11px] leading-4 num ${s.accent ? 'text-white/80' : 'text-ink-secondary'}`}>
              Заказ {order.shortCode}
              {s.detail ? ` · ${s.detail}` : ''}
              {offline ? ' · без сети' : ''}
            </span>
          </span>
          {order.estimateTotal > 0 && (
            <span className={`text-[12px] leading-4 num flex-none ${s.accent ? 'text-white/85' : 'text-ink-secondary'}`}>
              ≈ {formatRub(order.estimateTotal * 100)} ₽
            </span>
          )}
          <ChevronRight size={16} strokeWidth={2} className={`flex-none ${s.accent ? 'text-white/85' : 'text-ink-tertiary'}`} />
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(order)}
      aria-label={`Заказ ${order.shortCode}, ${s.label}`}
      className={`w-full text-left rounded-2xl border px-3.5 py-3 flex items-center gap-3 shadow-card active:opacity-95 motion-reduce:transition-none ${
        s.accent ? 'bg-brand text-white border-brand' : 'bg-white border-line text-ink'
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={`text-[15px] leading-5 font-semibold num ${s.accent ? 'text-white' : 'text-ink'}`}>
            {s.label}
          </span>
          {offline && (
            <span className={`text-[10px] leading-3 font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
              s.accent ? 'bg-white/20 text-white' : 'bg-warn-bg text-warn'
            }`}>
              без сети
            </span>
          )}
        </span>
        <span className={`block mt-0.5 text-[12px] leading-4 num ${s.accent ? 'text-white/80' : 'text-ink-secondary'}`}>
          Заказ {order.shortCode}
          {storeName ? ` · ${storeName}` : ''}
          {s.detail ? ` · ${s.detail}` : ''}
        </span>
        {/* Мини-шкала: 4 точки «отправлен → принят → готовится → готов» */}
        <span className="mt-2 flex items-center gap-1" aria-hidden="true">
          {STEPS.map((step, i) => (
            <span
              key={step}
              className={`h-1 flex-1 rounded-full ${
                i < filledIndex ? (s.accent ? 'bg-white' : 'bg-brand') : s.accent ? 'bg-white/30' : 'bg-pale'
              }`}
            />
          ))}
        </span>
      </span>
      <span className="shrink-0 justify-self-end flex items-center gap-1">
        {order.estimateTotal > 0 && (
          <span className={`text-[12px] leading-4 num ${s.accent ? 'text-white/80' : 'text-ink-secondary'}`}>
            ≈ {formatRub(order.estimateTotal * 100)} ₽
          </span>
        )}
        <ChevronRight size={16} strokeWidth={2} className={s.accent ? 'text-white/80' : 'text-ink-tertiary'} />
      </span>
    </button>
  )
}

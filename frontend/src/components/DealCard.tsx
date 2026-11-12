import type { ReactNode } from 'react'
import { ChevronRight } from '../lib/icons'

/**
 * Карточка акции/купона на главной.
 *
 * Всё содержимое — из админки (`promos.title`, `body`, `cta_label`, `badge`,
 * `image_url`). Никакого фиксированного текста внутри: если владелец написал
 * «Сезонные товары», на карточке будет «Сезонные товары».
 *
 * Два вида: `wide` — одна карточка на всю ширину (медиа слева), обычная — в
 * горизонтальном рельсе (медиа сверху). Без картинки рисуется брендовый
 * градиент, а не пустая серая плашка.
 */
type Props = {
  title: string
  body?: string
  cta?: string
  badge?: string | null
  imageUrl?: string | null
  mediaType?: 'image' | 'video'
  /** Иконка поверх градиента, когда картинки нет (например, купон). */
  mediaIcon?: ReactNode
  wide?: boolean
  onClick: () => void
}

const badgeText = (b?: string | null) =>
  b === 'new' ? 'Новинка' : b === 'hit' ? 'Хит' : b === 'seasonal' ? 'Сезон' : null

export default function DealCard({
  title, body, cta, badge, imageUrl, mediaType, mediaIcon, wide = false, onClick,
}: Props) {
  const chip = badgeText(badge)
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group text-left rounded-2xl overflow-hidden bg-white border border-line shadow-card active:scale-[0.995] motion-reduce:transition-none ${
        wide ? 'w-full flex items-stretch' : 'w-full flex flex-col'
      }`}
    >
      <span className={`relative block overflow-hidden flex-none ${wide ? 'w-[104px]' : 'h-[92px] w-full'}`}>
        {imageUrl ? (
          mediaType === 'video' ? (
            <video
              src={imageUrl}
              className="absolute inset-0 w-full h-full object-cover"
              autoPlay muted loop playsInline preload="metadata" aria-hidden="true"
            />
          ) : (
            <img
              src={imageUrl}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              loading="lazy"
              decoding="async"
            />
          )
        ) : (
          <>
            <span className="absolute inset-0 bg-gradient-to-br from-brand-mid via-brand to-brand-deep" aria-hidden="true" />
            {mediaIcon ? (
              <span className="absolute inset-0 flex items-center justify-center text-white/90" aria-hidden="true">
                {mediaIcon}
              </span>
            ) : (
              <span className="absolute right-2 bottom-1 font-display font-bold text-[26px] leading-none text-white/25" aria-hidden="true">
                6<span className="brand-dot" />7
              </span>
            )}
          </>
        )}
        {chip ? (
          <span className="absolute left-2 top-2 inline-flex items-center h-[20px] px-2 rounded-full bg-white/95 text-[10px] leading-none font-semibold text-brand">
            {chip}
          </span>
        ) : null}
      </span>

      <span className={`min-w-0 p-2.5 ${wide ? 'flex-1' : ''}`}>
        {/* ВАЖНО: без `block` — Tailwind line-clamp ставит display:-webkit-box,
            а `block` побеждает в каскаде и обрезка молча перестаёт работать. */}
        <span className="font-display font-semibold text-[13px] leading-[17px] text-ink line-clamp-2">{title}</span>
        {body ? <span className="mt-0.5 text-[11px] leading-[14px] text-ink-secondary line-clamp-2">{body}</span> : null}
        {cta ? (
          <span className="mt-2 inline-flex items-center gap-0.5 text-[11px] leading-4 font-semibold text-brand">
            {cta}
            <ChevronRight size={12} strokeWidth={2.2} />
          </span>
        ) : null}
      </span>
    </button>
  )
}

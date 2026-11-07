import type { MenuItem } from '../../lib/menuModel'

type Props = {
  item: MenuItem
  /** Заголовок из CMS («Раф ванильный»), если он отличается от названия товара. */
  title?: string | null
  /** Подзаголовок из CMS. */
  body?: string | null
  imageUrl?: string | null
  onOpen: () => void
}

/**
 * Сезонный hero 3:2 над категориями: фото, бейдж «Сезон», название и описание.
 * Показываем только когда в админке есть контент (или отмечен сезонный товар).
 */
export default function SeasonHero({ item, title, body, imageUrl, onOpen }: Props) {
  const caption = body || item.product.description || ''
  const headline = title || item.product.name
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full text-left rounded-3xl overflow-hidden bg-white border border-line shadow-card active:opacity-95"
    >
      <div className="relative aspect-[3/2] bg-pale">
        {imageUrl || item.product.imageUrl ? (
          <img
            src={String(imageUrl || item.product.imageUrl)}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-brand/40">
            <img src="/logo-mark.png" alt="" className="w-16 h-16 opacity-40" aria-hidden="true" />
          </div>
        )}
        <span className="absolute left-3 bottom-3 inline-flex items-center rounded-full bg-white/90 text-brand px-2.5 py-1 text-[11px] leading-4 font-semibold uppercase tracking-wide">
          Сезон
        </span>
      </div>
      <div className="px-4 py-3">
        <h3 className="font-display text-[19px] leading-6 font-semibold text-ink">{headline}</h3>
        {caption ? <p className="mt-1 text-[13px] leading-[18px] text-ink-secondary line-clamp-2">{caption}</p> : null}
      </div>
    </button>
  )
}

import { memo, useState } from 'react'
import { Info } from '../../lib/icons'
import { formatKcal, formatPrice, formatSize, isOrderable, type BadgeKind, type MenuItem } from '../../lib/menuModel'
import Badge from './Badge'
import ProductPhoto from './ProductPhoto'

type Props = {
  item: MenuItem
  onSelect: (item: MenuItem) => void
  eager?: boolean
  /** Для длинных сеток: браузер не рендерит карточки вне экрана (content-visibility). */
  defer?: boolean
  /** Переопределить бейдж (ряд «Стоит попробовать»). */
  badge?: BadgeKind | null
  className?: string
}

/**
 * Карточка витрины: фото 1:1, имя (≤2 строк), вес/объём, цена, максимум один бейдж.
 * Если задана калорийность — на фото кнопка «i»: тап раскрывает пилюлю с ккал, повторный тап сворачивает.
 * Кнопка «i» — соседний элемент, а не вложенная в кнопку карточки (валидный HTML, свой фокус).
 */
function ProductCard({ item, onSelect, eager = false, defer = false, className = '', badge: badgeProp }: Props) {
  const { product: p } = item
  const badge = badgeProp === undefined ? item.badge : badgeProp
  const sizes = item.variants ?? []
  const size = formatSize(p)
  const kcal = formatKcal(p)
  const [open, setOpen] = useState(false)
  const soldOut = !isOrderable(item)

  return (
    <div
      className={`guest-card relative min-w-0 ${
        defer ? '[content-visibility:auto] [contain-intrinsic-size:auto_250px]' : ''
      } ${className}`}
    >
      <button
        type="button"
        onClick={() => onSelect(item)}
        aria-disabled={soldOut}
        className="block w-full text-left active:scale-[0.98] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
      >
        <div className="relative">
          <ProductPhoto
            name={p.name}
            icon={p.icon}
            imageUrl={p.imageUrl}
            mediaType={p.mediaType ?? null}
            videoUrl={p.videoUrl ?? null}
            posterUrl={p.posterUrl ?? null}
            ratio="poster"
            eager={eager}
          />
          {badge && !soldOut ? <Badge kind={badge} className="absolute left-2 top-2" /> : null}
          {soldOut ? (
            <span className="absolute inset-x-2 top-2 inline-flex justify-center rounded-full bg-ink/80 px-2 py-0.5 text-[11px] leading-4 font-semibold text-white">
              Нет в наличии
            </span>
          ) : null}
        </div>
        <div className="px-3 py-2.5">
          <div className={`text-[17px] leading-[22px] font-medium line-clamp-2 min-h-[44px] ${soldOut ? 'text-[color:var(--c-fg-tertiary)]' : 'text-[color:var(--c-fg-ink)]'}`}>
            {p.name}
          </div>
          <div className="text-[14px] leading-[16px] text-[color:var(--c-fg-tertiary)] num mt-0.5 min-h-4">
            {sizes.length > 1 ? sizes.map((v) => v.label).join(' · ') : size}
          </div>
          <div
            className="text-[19px] leading-6 font-medium num text-[color:var(--c-fg-ink)] mt-0.5"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {sizes.length > 1
              ? `от ${formatPrice(Math.min(p.price, ...sizes.map((v) => v.price)))}`
              : p.hasVolumes
                ? `от ${formatPrice(p.priceFrom ?? p.price)}`
                : formatPrice(p.price)}
          </div>
        </div>
      </button>

      {kcal ? (
        <div className="absolute inset-x-0 top-0 aspect-[4/5] flex items-end justify-end p-2 pointer-events-none">
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? `Калорийность: ${kcal}. Свернуть` : 'Показать калорийность'}
            onClick={() => setOpen((v) => !v)}
            className="pointer-events-auto inline-flex items-center h-8 min-w-8 rounded-full bg-white/95 text-brand shadow-card border border-line/80 backdrop-blur-sm overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <span className="w-8 h-8 shrink-0 flex items-center justify-center">
              <Info size={16} strokeWidth={2} aria-hidden="true" />
            </span>
            <span
              className={`whitespace-nowrap text-[12px] leading-4 font-semibold text-ink num transition-[max-width,opacity,padding] duration-200 motion-reduce:transition-none ${
                open ? 'max-w-[120px] opacity-100 pr-3' : 'max-w-0 opacity-0 pr-0'
              }`}
            >
              {kcal}
            </span>
          </button>
        </div>
      ) : null}
    </div>
  )
}

export default memo(ProductCard)

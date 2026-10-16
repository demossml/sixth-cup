import { memo, useState } from 'react'
import { Info } from '../../lib/icons'
import { formatKcal, formatPrice, formatSize, type BadgeKind, type MenuItem } from '../../lib/menuModel'
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
  const size = formatSize(p)
  const kcal = formatKcal(p)
  const [open, setOpen] = useState(false)

  return (
    <div
      className={`relative min-w-0 rounded-2xl overflow-hidden bg-white border border-line/80 shadow-card ${
        defer ? '[content-visibility:auto] [contain-intrinsic-size:auto_250px]' : ''
      } ${className}`}
    >
      <button
        type="button"
        onClick={() => onSelect(item)}
        className="block w-full text-left active:scale-[0.98] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
      >
        <div className="relative">
          <ProductPhoto name={p.name} icon={p.icon} imageUrl={p.imageUrl} eager={eager} />
          {badge ? <Badge kind={badge} className="absolute left-2 top-2" /> : null}
        </div>
        <div className="px-2.5 py-2.5">
          <div className="text-[13px] leading-[17px] font-medium text-ink line-clamp-2 min-h-[34px]">{p.name}</div>
          <div className="text-[12px] leading-4 text-ink-secondary num mt-0.5 min-h-4">{size}</div>
          <div className="font-display text-[15px] leading-5 font-semibold num text-ink mt-0.5">{formatPrice(p.price)}</div>
        </div>
      </button>

      {kcal ? (
        <div className="absolute inset-x-0 top-0 aspect-square flex items-end justify-end p-2 pointer-events-none">
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

import { useEffect, useRef } from 'react'
import { X } from '../../lib/icons'
import { formatKcal, formatPrice, formatSize, type MenuItem, type ModifierGroup } from '../../lib/menuModel'
import Badge from './Badge'
import ProductPhoto from './ProductPhoto'

type Props = {
  item: MenuItem
  groups: ModifierGroup[]
  onClose: () => void
  onShowCard: () => void
}

const FOCUSABLE = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])'

/**
 * Sheet позиции: фото, цена, описание, модификаторы (только просмотр), бейдж подарка,
 * CTA на карту. Закрытие: X, backdrop, Escape. Без корзины и выбора количества.
 */
export default function ProductSheet({ item, groups, onClose, onShowCard }: Props) {
  const { product: p } = item
  const panel = useRef<HTMLElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeBtn.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab' || !panel.current) return
      // минимальный focus trap: Tab не уходит за пределы диалога
      const nodes = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (!nodes.length) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const cur = document.activeElement
      if (e.shiftKey && cur === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      opener?.focus?.()
    }
  }, [onClose])

  const promo = item.cmsBadge
  const facts = [formatSize(p), formatKcal(p)].filter(Boolean).join(' · ')

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/45" role="presentation" onClick={onClose}>
      <section
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-sheet-title"
        className="relative w-full max-w-[480px] mx-auto max-h-[92dvh] overflow-y-auto overscroll-contain rounded-t-[28px] bg-page shadow-2xl animate-[sheet-up_220ms_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative">
          <ProductPhoto name={p.name} icon={p.icon} imageUrl={p.imageUrl} ratio="wide" eager drift={p.id} />
          <button
            ref={closeBtn}
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="absolute right-3 top-3 w-11 h-11 rounded-full bg-black/45 backdrop-blur-sm flex items-center justify-center text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <X size={20} strokeWidth={1.75} />
          </button>
        </div>

        <div className="px-5 pt-4">
          <div className="flex items-start justify-between gap-3">
            <h2 id="product-sheet-title" className="font-display text-[22px] leading-7 font-semibold text-ink min-w-0 break-words">
              {p.name}
            </h2>
            <span className="font-display text-[22px] leading-7 font-semibold num text-ink whitespace-nowrap">{formatPrice(p.price)}</span>
          </div>

          {facts ? <p className="mt-1 text-[14px] leading-5 text-ink-secondary num">{facts}</p> : null}

          {promo ? <div className="mt-2"><Badge kind={promo} /></div> : null}

          {p.description ? <p className="text-[15px] leading-[22px] text-ink-secondary mt-2">{p.description}</p> : null}

          {groups.length > 0 ? (
            <section className="mt-4" aria-label="Что можно добавить">
              <h3 className="text-[13px] leading-[18px] font-semibold text-ink">Что можно добавить на кассе</h3>
              <div className="mt-2 space-y-3">
                {groups.map((g) => (
                  <div key={g.key}>
                    <div className="text-[12px] leading-4 text-ink-tertiary mb-1.5">{g.label}</div>
                    <ul className="flex flex-wrap gap-1.5">
                      {g.items.map((m) => (
                        <li key={m.id} className="rounded-full bg-white border border-line px-3 py-1.5 text-[13px] leading-[18px] text-ink">
                          {m.name}
                          {m.price > 0 ? <span className="num text-ink-secondary">{` +${formatPrice(m.price)}`}</span> : null}
                          {m.maxCount > 1 ? <span className="text-ink-tertiary">{` · до ${m.maxCount}`}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <p className="text-[13px] leading-[18px] text-ink-secondary mt-4">Заказ и оплата — на кассе.</p>
        </div>

        {/* CTA всегда в зоне большого пальца, даже при длинном списке добавок */}
        <div
          className="sticky bottom-0 bg-page/95 backdrop-blur-sm px-5 pt-3"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
          <button type="button" onClick={onShowCard} className="btn min-h-12">
            На кассе покажите карту
          </button>
        </div>
      </section>
    </div>
  )
}

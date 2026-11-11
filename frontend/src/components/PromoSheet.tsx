import { useEffect } from 'react'
import { X, ChevronRight } from '../lib/icons'

/**
 * Модальное окно акции (CON-1): по тапу на карточку гость видит описание,
 * а не улетает сразу в меню. Всё содержимое — из админки.
 *
 * Механика: затемнение на весь экран + лист снизу. Закрытие — крестик, тап по
 * затемнению, Escape. Пока окно открыто, страница не скроллится.
 */
export type PromoSheetItem = {
  title: string
  body?: string
  imageUrl?: string | null
  mediaType?: 'image' | 'video'
  ctaLabel?: string
}

type Props = {
  item: PromoSheetItem
  /** Кнопка внизу: куда вести. Без обработчика кнопки нет. */
  onGo?: () => void
  /** Подпись нижней кнопки (по умолчанию — CTA из админки или «Открыть меню»). */
  goLabel?: string
  onClose: () => void
}

export default function PromoSheet({ item, onGo, goLabel, onClose }: Props) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/45 animate-[fade-in_140ms_ease-out]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={item.title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[480px] bg-white rounded-t-3xl overflow-hidden shadow-lift max-h-[86vh] flex flex-col animate-[sheet-up_180ms_ease-out]"
      >
        <div className="relative flex-none">
          {item.imageUrl ? (
            item.mediaType === 'video' ? (
              <video
                src={item.imageUrl}
                className="w-full h-[180px] object-cover bg-brand-tint"
                autoPlay muted loop playsInline preload="metadata"
              />
            ) : (
              <img src={item.imageUrl} alt="" className="w-full h-[180px] object-cover bg-brand-tint" loading="lazy" />
            )
          ) : (
            <div className="h-[92px] bg-gradient-to-br from-brand-mid via-brand to-brand-deep relative">
              <span className="absolute right-3 bottom-2 font-display font-bold text-[28px] leading-none text-white/25" aria-hidden="true">
                6<span className="brand-dot" />7
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="absolute top-2.5 right-2.5 w-9 h-9 rounded-full bg-white/90 text-ink flex items-center justify-center shadow-card"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <div className="p-4 overflow-y-auto">
          <h2 className="font-display font-semibold text-[19px] leading-6 text-ink">{item.title}</h2>
          {item.body ? (
            <p className="mt-2 text-[14px] leading-5 text-ink-secondary whitespace-pre-line">{item.body}</p>
          ) : null}
        </div>

        {onGo ? (
          <div className="p-3 pt-0 flex-none" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}>
            <button type="button" className="btn min-h-12 inline-flex items-center justify-center gap-1" onClick={onGo}>
              {goLabel || item.ctaLabel || 'Открыть меню'}
              <ChevronRight size={16} strokeWidth={2.2} />
            </button>
          </div>
        ) : (
          <div className="flex-none" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }} />
        )}
      </div>
    </div>
  )
}

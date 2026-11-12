import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import QrLayer from '../components/QrLayer'
import { useApp } from '../lib/app'
import { isVisibleAt, minutesOf, weekdayIndex, windowLabel } from '../lib/dealWindow'
import { ChevronLeft, ChevronRight, QrCode } from '../lib/icons'

/**
 * Экран акции (CON-5). Заменяет модалку: у лидеров оффер всегда живёт на
 * отдельном экране — с постером целиком, полным описанием, условиями и одним
 * действием внизу.
 *
 * Данные берём из уже загруженного каталога (офлайн тоже работает). Если акция
 * скрыта по времени/дням, гость видит «Акция закончилась», а не пустую страницу.
 */
export default function PromoPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const { dir, me, best } = useApp()
  const [qrOpen, setQrOpen] = useState(false)
  // Пропорция баннера берётся из файла (см. PromoBanner на главной).
  const [mediaRatio, setMediaRatio] = useState<string>('4 / 5')
  const nowMs = Date.now()
  const minutes = minutesOf(new Date(nowMs))
  const weekday = weekdayIndex(new Date(nowMs))

  const content = (dir?.content ?? dir?.promos ?? []) as Array<{
    id: number; title?: string; subtitle?: string | null; body?: string; terms?: string | null
    imageUrl?: string | null; mediaType?: 'image' | 'video'; imageFit?: 'contain' | 'cover' | null
    ctaLabel?: string | null; tapAction?: 'modal' | 'product' | 'menu'; productId?: number | null
    timeFrom?: number | null; timeTo?: number | null; daysMask?: number | null
    placement?: string
  }>

  const item = content.find((x) => String(x.id) === String(id))
  const visible = item
    ? isVisibleAt({ from: item.timeFrom, to: item.timeTo, daysMask: item.daysMask }, minutes, weekday)
    : false

  // Прокрутка к началу при входе — экран длинный.
  useEffect(() => { window.scrollTo({ top: 0 }) }, [id])

  const proof = best?.token
  const cardCode = me?.cardCode ?? ''

  const firstLine = (s?: string | null) => (s || '').split('\n').map((x) => x.trim()).find(Boolean) || ''
  const rawTitle = (item?.title || '').trim()
  const title = rawTitle || firstLine(item?.subtitle) || firstLine(item?.body).slice(0, 60) || 'Акция'
  const bodyRaw = (item?.body || '').trim()
  // Если заголовок пришлось взять из описания — не показываем его же ещё раз.
  const body = bodyRaw && !bodyRaw.startsWith(title) ? bodyRaw : ''
  const terms = (item?.terms || '').trim()
  const action = item?.tapAction || 'modal'
  const goLabel = action === 'product' && item?.productId
    ? (item.ctaLabel?.trim() || 'Перейти к товару')
    : action === 'menu'
      ? (item?.ctaLabel?.trim() || 'Открыть меню')
      : (item?.ctaLabel?.trim() || 'Открыть меню')

  const go = () => {
    if (action === 'product' && item?.productId) return nav(`/menu/${item.productId}`)
    return nav('/menu')
  }

  return (
    <div className="pb-28">
      <div className="px-4 pt-3">
        <button
          type="button"
          onClick={() => (window.history.length > 1 ? nav(-1) : nav('/'))}
          className="inline-flex items-center gap-1 min-h-11 text-[13px] font-semibold text-ink-secondary"
        >
          <ChevronLeft size={18} strokeWidth={2} />
          Назад
        </button>
      </div>

      {!dir ? (
        <p className="px-4 py-10 text-center text-sm text-ink-secondary">Загружаем акцию…</p>
      ) : !item || !visible ? (
        <div className="px-4 py-10 text-center">
          <p className="text-[17px] font-semibold text-ink">Акция недоступна</p>
          <p className="mt-1 text-sm text-ink-secondary">Возможно, она уже закончилась или показывается в другое время.</p>
          <button type="button" className="btn mt-4 max-w-[280px]" onClick={() => nav('/')}>На главную</button>
        </div>
      ) : (
        <>
          {/* Пропорция — из самого файла: баннер заполняет площадь без полей и обрезки. */}
          <div className="px-4">
            <div
              className="relative w-full rounded-3xl overflow-hidden shadow-lift bg-brand-soft"
              style={{ aspectRatio: mediaRatio }}
            >
              {item.imageUrl ? (
                item.mediaType === 'video' ? (
                  <video
                    src={item.imageUrl}
                    className="absolute inset-0 w-full h-full object-cover"
                    autoPlay muted loop playsInline preload="metadata"
                    aria-label={title}
                  />
                ) : (
                  <img
                    src={item.imageUrl}
                    alt={title}
                    className="absolute inset-0 w-full h-full object-cover"
                    onLoad={(e) => {
                      const img = e.currentTarget
                      if (img.naturalWidth && img.naturalHeight) {
                        setMediaRatio(String(Math.min(1.6, Math.max(0.6, img.naturalWidth / img.naturalHeight))))
                      }
                    }}
                  />
                )
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-brand-mid via-brand to-brand-deep">
                  <span className="absolute right-4 bottom-3 font-display font-bold text-[44px] leading-none text-white/25" aria-hidden="true">
                    6<span className="brand-dot" />7
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="px-4 pt-4">
            <h1 className="font-display font-semibold text-[22px] leading-7 text-ink">{title}</h1>
            {item.subtitle ? (
              <p className="mt-1.5 text-[14px] leading-5 text-ink-secondary">{item.subtitle}</p>
            ) : null}
            {body ? (
              <p className="mt-3 text-[15px] leading-[22px] text-ink whitespace-pre-line">{body}</p>
            ) : null}

            <div className="mt-4 rounded-2xl border border-line bg-white p-3">
              <p className="text-[11px] leading-4 font-semibold uppercase tracking-[0.08em] text-ink-secondary">
                Когда действует
              </p>
              <p className="mt-1 text-[13px] leading-5 text-ink num">{windowLabel({ from: item.timeFrom, to: item.timeTo })}</p>
              {terms ? (
                <>
                  <p className="mt-3 text-[11px] leading-4 font-semibold uppercase tracking-[0.08em] text-ink-secondary">
                    Условия
                  </p>
                  <p className="mt-1 text-[13px] leading-5 text-ink whitespace-pre-line">{terms}</p>
                </>
              ) : null}
            </div>

            {proof ? (
              <button
                type="button"
                onClick={() => setQrOpen(true)}
                className="mt-3 w-full inline-flex items-center justify-center gap-2 min-h-12 rounded-xl bg-brand-tint text-brand font-semibold text-[14px]"
              >
                <QrCode size={18} strokeWidth={1.9} />
                Показать QR карты
              </button>
            ) : null}
          </div>

          {/* Действие всегда под рукой: не надо возвращаться наверх. */}
          <div
            className="fixed left-0 right-0 z-30 flex justify-center px-3 pointer-events-none"
            style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom, 0px) + 0.5rem)' }}
          >
            <button
              type="button"
              onClick={go}
              className="pointer-events-auto w-full max-w-[456px] min-h-12 rounded-full bg-brand text-white font-semibold text-[15px] inline-flex items-center justify-center gap-1 shadow-lift"
            >
              {goLabel}
              <ChevronRight size={16} strokeWidth={2.2} />
            </button>
          </div>
        </>
      )}

      {qrOpen && proof ? (
        <QrLayer proof={proof} cardCode={cardCode} onClose={() => setQrOpen(false)} />
      ) : null}
    </div>
  )
}

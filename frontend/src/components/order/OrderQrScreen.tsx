import { useEffect, useState } from 'react'
import Qr from '../Qr'
import { cancelPreorder, getPreorder, type OrderOut } from '../../lib/preorderApi'
import { X } from '../../lib/icons'

const STEPS = [
  { key: 'draft', label: 'Отправлен' },
  { key: 'accepted', label: 'Принят' },
  { key: 'cooking', label: 'Готовится' },
  { key: 'ready', label: 'Готов' },
  { key: 'paid', label: 'Оплачен' },
] as const

const TERMINAL = new Set(['paid', 'cancelled', 'rejected', 'expired'])

function statusIndex(status: string) {
  const i = STEPS.findIndex((s) => s.key === status)
  return i < 0 ? 0 : i
}

type Props = {
  orderId: string
  qrPayload: string
  initial?: OrderOut
  onClose: () => void
  onOpenLoyalty?: () => void
}

/**
 * QR предзаказа + статус. QR рисуется локально (`qrcode`), а не через внешний сервис:
 * payload заказа не должен уходить третьим лицам. Статус опрашивается раз в 5 с.
 */
export function OrderQrScreen({ orderId, qrPayload, initial, onClose, onOpenLoyalty }: Props) {
  const [order, setOrder] = useState<OrderOut | null>(initial ?? null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    let alive = true
    const tick = async () => {
      const o = await getPreorder(orderId)
      if (!alive || !o) return
      setOrder(o)
    }
    void tick()
    const id = setInterval(() => {
      if (order && TERMINAL.has(order.status)) return
      void tick()
    }, 5000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [orderId, order])

  const expMs = order ? new Date(order.expiresAt).getTime() : 0
  const left = Math.max(0, Math.floor((expMs - now) / 1000))
  const mm = String(Math.floor(left / 60)).padStart(2, '0')
  const ss = String(left % 60).padStart(2, '0')
  const step = statusIndex(order?.status || 'draft')
  const finished = order ? TERMINAL.has(order.status) : false

  return (
    <div className="fixed inset-0 z-50 bg-page overflow-y-auto" role="dialog" aria-modal="true" aria-label="Заказ">
      <div className="max-w-[480px] mx-auto px-4 pb-10" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] leading-4 text-ink-secondary">Заказ</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="w-11 h-11 rounded-full bg-white border border-line flex items-center justify-center text-ink"
          >
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>

        <h1 className="font-display text-[26px] leading-8 font-semibold text-ink num">
          Заказ {order?.shortCode || '······'}
        </h1>
        <p className="mt-1 text-[13px] leading-[18px] text-ink-secondary">Покажите кассиру. Это не карта лояльности.</p>

        <div className="mt-4 bg-white border border-line rounded-3xl p-4 flex justify-center shadow-card">
          <div className="w-[240px] max-w-full">
            <Qr value={qrPayload} size={240} alt="QR заказа" />
          </div>
        </div>

        <p className="mt-3 text-center font-display text-[28px] leading-9 tracking-[0.2em] num text-ink">{order?.shortCode}</p>
        <p className="mt-1 text-center text-[13px] leading-4 text-ink-secondary num">
          ◷ {mm}:{ss} · оценка {order?.estimateTotal ?? '—'} ₽
        </p>

        <ol className="mt-6 space-y-2">
          {STEPS.map((s, i) => {
            const done = i < step
            const active = i === step
            return (
              <li key={s.key} className={`flex items-center gap-2.5 ${i <= step ? '' : 'opacity-40'}`}>
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold ${
                    done || active ? 'bg-brand text-white' : 'bg-pale text-brand'
                  }`}
                >
                  {done ? '✓' : i + 1}
                </span>
                <span className={active ? 'text-[15px] font-semibold text-ink' : 'text-[15px] text-ink-secondary'}>{s.label}</span>
              </li>
            )
          })}
        </ol>

        {order?.status === 'ready' && (
          <div className="mt-3 rounded-2xl bg-ok/10 text-ok px-3.5 py-3 text-[14px] leading-5 font-semibold">Можно забирать</div>
        )}
        {(order?.status === 'rejected' || order?.status === 'cancelled') && (
          <div className="mt-3 rounded-2xl bg-warn-bg text-warn px-3.5 py-3 text-[14px] leading-5">
            Заказ {order.status === 'rejected' ? 'отклонён кассой' : 'отменён'}. Сумма не списывалась.
          </div>
        )}
        {order?.status === 'expired' && (
          <div className="mt-3 rounded-2xl bg-warn-bg text-warn px-3.5 py-3 text-[14px] leading-5">Срок заказа истёк — оформите новый.</div>
        )}

        <div className="mt-6 space-y-2">
          {!finished && (
            <button
              type="button"
              onClick={async () => {
                await cancelPreorder(orderId)
                onClose()
              }}
              className="btn-ghost min-h-12 w-full"
            >
              Отменить заказ
            </button>
          )}
          {onOpenLoyalty && (
            <button type="button" onClick={onOpenLoyalty} className="btn min-h-12 w-full">
              Открыть карту лояльности
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

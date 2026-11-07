import { useEffect, useRef, useState } from 'react'
import Qr from '../Qr'
import PushToggle from '../PushToggle'
import { cancelPreorder, getPreorder, markReceived, type OrderOut } from '../../lib/preorderApi'
import { etaLeftSec } from '../../lib/orderBanner'
import { clearOrderRef } from '../../lib/preorderApi'
import { X } from '../../lib/icons'

const STEPS = [
  { key: 'draft', label: 'Отправлен' },
  { key: 'accepted', label: 'Принят' },
  { key: 'cooking', label: 'Готовится' },
  { key: 'ready', label: 'Готов' },
  { key: 'paid', label: 'Оплачен' },
] as const

const TERMINAL = new Set(['paid', 'cancelled', 'rejected', 'expired'])
const plMinutes = (n: number) => {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return `${n} минуту`
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} минуты`
  return `${n} минут`
}

function statusIndex(status: string) {
  const i = STEPS.findIndex((s) => s.key === status)
  return i < 0 ? 0 : i
}

type Props = {
  orderId: string
  /** Есть сразу после создания; после перезагрузки может отсутствовать — тогда показываем код и таймлайн. */
  qrPayload?: string | null
  initial?: OrderOut
  onClose: () => void
  onOpenLoyalty?: () => void
  /** Статус на сервере изменился (например, касса отклонила заказ) — родитель обновляет баннер. */
  onStatusChange?: (order: OrderOut) => void
}

/**
 * QR предзаказа + статус. QR рисуется локально (`qrcode`), а не через внешний сервис:
 * payload заказа не должен уходить третьим лицам. Статус опрашивается раз в 5 с.
 */
export function OrderQrScreen({ orderId, qrPayload, initial, onClose, onOpenLoyalty, onStatusChange }: Props) {
  const [order, setOrder] = useState<OrderOut | null>(initial ?? null)
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Опрос завязан только на orderId: обновление state не должно пересоздавать таймер,
  // иначе каждый ответ запускает следующий запрос и получается бесконечный цикл.
  const statusRef = useRef<string | null>(initial?.status ?? null)
  const statusChangeRef = useRef(onStatusChange)
  useEffect(() => {
    statusChangeRef.current = onStatusChange
  }, [onStatusChange])

  useEffect(() => {
    let alive = true
    const tick = async () => {
      const o = await getPreorder(orderId)
      if (!alive || !o) return
      setOrder(o)
      if (statusRef.current !== o.status) {
        statusRef.current = o.status
        statusChangeRef.current?.(o)
      }
    }
    void tick()
    const id = setInterval(() => {
      if (document.hidden) return
      if (statusRef.current && TERMINAL.has(statusRef.current)) return
      void tick()
    }, 5000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [orderId])

  const expMs = order ? new Date(order.expiresAt).getTime() : 0
  const left = Math.max(0, Math.floor((expMs - now) / 1000))
  const mm = String(Math.floor(left / 60)).padStart(2, '0')
  const ss = String(left % 60).padStart(2, '0')
  const step = statusIndex(order?.status || 'draft')

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
        <p className="mt-1 text-[13px] leading-[18px] text-ink-secondary">
          {order?.status === 'paid'
            ? 'Назовите номер бариста — заказ оплачен.'
            : order?.status === 'ready'
              ? 'Заказ готов — покажите номер на кассе.'
              : 'Покажите кассиру. Это не карта лояльности.'}
        </p>

        <div className="mt-4 bg-white border border-line rounded-3xl p-4 flex flex-col items-center shadow-card">
          {qrPayload ? (
            <div className="w-[240px] max-w-full">
              <Qr value={qrPayload} size={240} alt="QR заказа" />
            </div>
          ) : (
            <p className="text-[13px] leading-[18px] text-ink-secondary text-center py-6">
              QR откроется после обновления страницы на кассе — назовите номер заказа.
            </p>
          )}
        </div>

        <p className="mt-3 text-center font-display text-[28px] leading-9 tracking-[0.2em] num text-ink">{order?.shortCode}</p>
        <p className="mt-1 text-center text-[13px] leading-4 text-ink-secondary num">
          {order?.status === 'draft' ? `◷ ${mm}:${ss} · ` : ''}оценка {order?.estimateTotal ?? '—'} ₽
        </p>
        {order && ['accepted', 'cooking'].includes(order.status) && (
          <p className="mt-1 text-center text-[13px] leading-4 font-semibold text-brand">
            {(() => {
              const left = etaLeftSec(order, now)
              if (left == null) return 'Готовность уточняется'
              if (left <= 0) return 'Готовим, осталось совсем немного'
              return `Будет готов примерно через ${plMinutes(Math.max(1, Math.ceil(left / 60)))}`
            })()}
          </p>
        )}
        {note && <p className="mt-2 text-center text-[13px] leading-[18px] text-bad">{note}</p>}

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
        {order && ['accepted', 'cooking'].includes(order.status) && (
          <PushToggle className="mt-3" />
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
          {order?.status === 'draft' && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                const ok = await cancelPreorder(orderId)
                setBusy(false)
                if (ok) {
                  clearOrderRef()
                  onClose()
                } else setNote('Не удалось отменить заказ. Попробуйте ещё раз.')
              }}
              className="btn-ghost min-h-12 w-full disabled:opacity-60"
            >
              Отменить заказ
            </button>
          )}
          {order?.status === 'paid' && !order.pickedUpAt && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                const ok = await markReceived(orderId)
                setBusy(false)
                if (ok) {
                  clearOrderRef()
                  onClose()
                } else setNote('Не удалось отметить получение. Попробуйте ещё раз.')
              }}
              className="btn min-h-12 w-full disabled:opacity-60"
            >
              Я забрал заказ
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

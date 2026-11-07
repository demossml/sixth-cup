import { useEffect, useState } from 'react'
import { BellRing, BellOff } from 'lucide-react'
import { pushState, subscribePush, type PushState } from '../lib/push'

/**
 * Кнопка «Включить уведомления»: push о готовности заказа.
 * Показываем только когда браузер поддерживает push и на сервере есть VAPID-ключи,
 * иначе блок просто не рендерим — заказ работает и без уведомлений.
 */
export default function PushToggle({ className = '' }: { className?: string }) {
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void pushState().then((s) => {
      if (alive) setState(s)
    })
    return () => {
      alive = false
    }
  }, [])

  if (state == null || state === 'unsupported' || state === 'disabled' || state === 'subscribed') return null

  const denied = state === 'denied'

  return (
    <button
      type="button"
      disabled={busy || denied}
      onClick={async () => {
        setBusy(true)
        const next = await subscribePush()
        setState(next)
        setBusy(false)
      }}
      className={`w-full min-h-11 rounded-xl border border-line bg-white px-3.5 flex items-center gap-2.5 text-left disabled:opacity-60 ${className}`}
    >
      {denied ? (
        <BellOff size={18} strokeWidth={1.75} className="text-ink-tertiary shrink-0" aria-hidden="true" />
      ) : (
        <BellRing size={18} strokeWidth={1.75} className="text-brand shrink-0" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] leading-5 font-semibold text-ink">
          {denied ? 'Уведомления выключены в браузере' : busy ? 'Включаем…' : 'Включить уведомления'}
        </span>
        <span className="block text-[12px] leading-4 text-ink-secondary">
          {denied
            ? 'Разрешите уведомления в настройках сайта — и мы напишем, когда заказ будет готов.'
            : 'Сообщим, когда заказ будет готов к выдаче'}
        </span>
      </span>
    </button>
  )
}

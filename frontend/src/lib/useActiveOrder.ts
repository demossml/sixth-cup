import { useCallback, useEffect, useRef, useState } from 'react'
import { getActiveOrder, loadOrderRef, saveOrderRef, clearOrderRef, type OrderOut } from './preorderApi'

/**
 * Активный заказ гостя для баннера.
 *
 * Правила:
 *  • опрос раз в 20 с только пока экран видим — в фоне не тратим батарею и трафик;
 *  • обновление на visibilitychange / online / focus;
 *  • последний успешный ответ держим в состоянии: при потере сети баннер не исчезает,
 *    а помечается как устаревший (offline = true);
 *  • при терминальном статусе локальная ссылка на заказ стирается.
 */
const POLL_MS = 20_000

export type ActiveOrder = {
  order: OrderOut | null
  bannedUntil: string | null
  /** true — показан последний известный ответ, сеть недоступна. */
  offline: boolean
  loading: boolean
  refresh: () => Promise<void>
}

export function useActiveOrder(): ActiveOrder {
  const [state, setState] = useState<{ order: OrderOut | null; bannedUntil: string | null }>({ order: null, bannedUntil: null })
  const [offline, setOffline] = useState(false)
  const [loading, setLoading] = useState(true)
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setOffline(true)
      setLoading(false)
      return
    }
    const next = await getActiveOrder()
    if (!alive.current) return
    setLoading(false)
    // Запрос не прошёл: оставляем последний известный статус и помечаем его как устаревший.
    if (!next.ok) {
      setOffline(true)
      return
    }
    setOffline(false)
    setState({ order: next.order, bannedUntil: next.bannedUntil })
    if (next.order) {
      saveOrderRef({ orderId: next.order.id, qrPayload: loadOrderRef()?.qrPayload ?? null })
    } else {
      clearOrderRef()
    }
  }, [])

  useEffect(() => {
    alive.current = true
    void refresh()

    const onVisible = () => { if (!document.hidden) void refresh() }
    const onOnline = () => void refresh()
    const onOffline = () => setOffline(true)
    const onFocus = () => void refresh()

    const timer = setInterval(() => {
      if (document.hidden) return
      void refresh()
    }, POLL_MS)

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('focus', onFocus)
    return () => {
      alive.current = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  return { ...state, offline, loading, refresh }
}

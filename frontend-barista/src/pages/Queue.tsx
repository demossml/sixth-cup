import { useCallback, useEffect, useRef, useState } from 'react'
import { apiGet, apiPatch, apiPost, isUnauthorized } from '../api'
import {
  STATUS_LABEL,
  ageLabel,
  itemsSummary,
  newOrderIds,
  shouldBlink,
  sortOrders,
  type KitchenOrder,
} from '../lib/queue'

type MeResponse = { user: { login: string; alertBlink: boolean; displayName: string | null; role: string } }

const POLL_MS = 2000

/**
 * Очередь точки. Опрос каждые 2 секунды (проще и надёжнее SSE на одном сервере);
 * при потере сети список остаётся на экране и показывается плашка.
 */
export default function QueuePage({ onLogout }: { onLogout: () => void }) {
  const [orders, setOrders] = useState<KitchenOrder[]>([])
  const [me, setMe] = useState<MeResponse['user'] | null>(null)
  const [alertBlink, setAlertBlink] = useState(true)
  const [offline, setOffline] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [savingBlink, setSavingBlink] = useState(false)

  const ordersRef = useRef<KitchenOrder[]>([])
  const blinkRef = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const res = await apiGet<{ orders: KitchenOrder[] }>('/kitchen/orders?status=active')
      const next = sortOrders(res.orders)
      const fresh = newOrderIds(ordersRef.current, next)
      if (fresh.length && blinkRef.current && typeof navigator.vibrate === 'function') {
        navigator.vibrate([120, 80, 120])
      }
      ordersRef.current = next
      setOrders(next)
      setOffline(false)
      setError('')
    } catch (e) {
      if (isUnauthorized(e)) {
        onLogout()
        return
      }
      // Сеть пропала — это не ошибка данных: список не чистим.
      setOffline(true)
    } finally {
      setLoaded(true)
    }
  }, [onLogout])

  useEffect(() => {
    let alive = true
    apiGet<MeResponse>('/me')
      .then((res) => {
        if (!alive) return
        setMe(res.user)
        setAlertBlink(res.user.alertBlink)
        blinkRef.current = res.user.alertBlink
      })
      .catch((e) => { if (isUnauthorized(e)) onLogout() })
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh, onLogout])

  const markSeen = async (order: KitchenOrder) => {
    if (order.status !== 'new' || busyId) return
    setBusyId(order.id)
    // Оптимистично гасим моргание: бариста уже открыл заказ.
    const next = sortOrders(ordersRef.current.map((o) => (o.id === order.id ? { ...o, status: 'seen' as const } : o)))
    ordersRef.current = next
    setOrders(next)
    try {
      await apiPost(`/kitchen/orders/${order.id}/seen`)
    } catch (e) {
      if (isUnauthorized(e)) onLogout()
      else setError('Не удалось отметить «принят» — попробуем ещё раз при обновлении')
    } finally {
      setBusyId(null)
    }
  }

  const markDone = async (order: KitchenOrder) => {
    if (busyId) return
    setBusyId(order.id)
    const next = ordersRef.current.filter((o) => o.id !== order.id)
    ordersRef.current = next
    setOrders(next)
    try {
      await apiPost(`/kitchen/orders/${order.id}/done`)
    } catch (e) {
      if (isUnauthorized(e)) onLogout()
      else {
        setError('Заказ не отмечен исполненным — вернём его в список')
        void refresh()
      }
    } finally {
      setBusyId(null)
    }
  }

  const toggleBlink = async () => {
    const next = !alertBlink
    setAlertBlink(next)
    blinkRef.current = next
    setSavingBlink(true)
    try {
      await apiPatch('/me', { alertBlink: next })
    } catch (e) {
      if (isUnauthorized(e)) {
        onLogout()
        return
      }
      setAlertBlink(!next)
      blinkRef.current = !next
      setError('Настройка не сохранилась')
    } finally {
      setSavingBlink(false)
    }
  }

  return (
    <main className="queue">
      <header className="queue-head">
        <div>
          <div className="queue-title">Очередь</div>
          <div className="queue-sub">
            {me?.displayName || me?.login || 'Сотрудник'}
            {me?.role === 'barista' ? '' : ' · все точки'}
          </div>
        </div>
        <div className="head-actions">
          <label className="toggle">
            <input type="checkbox" checked={alertBlink} disabled={savingBlink} onChange={toggleBlink} />
            <span>Моргание</span>
          </label>
          <button type="button" className="btn-quiet" onClick={onLogout}>Выйти</button>
        </div>
      </header>

      {offline && (
        <div className="banner banner-warn" role="status">
          Нет сети — показываем последние полученные заказы
        </div>
      )}
      {error && (
        <div className="banner banner-bad" role="alert">{error}</div>
      )}

      {!loaded ? (
        <div className="empty">Загрузка…</div>
      ) : orders.length === 0 ? (
        <div className="empty">
          <div className="empty-title">Заказов нет</div>
          <div className="empty-text">Новый заказ появится здесь сразу после оплаты на кассе.</div>
        </div>
      ) : (
        <ul className="queue-grid">
          {orders.map((order) => {
            const blink = shouldBlink(order, alertBlink)
            return (
              <li key={order.id} className={blink ? 'card card-new is-blinking' : 'card card-new'}>
                <button
                  type="button"
                  className="card-body"
                  onClick={() => void markSeen(order)}
                  disabled={order.status !== 'new'}
                  aria-label={blink ? `Новый заказ №${order.queueNumber}, открыть` : `Заказ №${order.queueNumber}`}
                >
                  <span className="card-top">
                    <span className="number">№{order.queueNumber ?? '—'}</span>
                    <span className={`status status-${order.status}`}>{STATUS_LABEL[order.status]}</span>
                  </span>
                  <span className="age">{ageLabel(order.createdAt)} назад</span>
                  <span className="items">{itemsSummary(order)}</span>
                  {order.items.some((i) => i.note) && (
                    <span className="note">
                      {order.items.filter((i) => i.note).map((i) => `${i.name}: ${i.note}`).join(' · ')}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className="btn-done"
                  onClick={() => void markDone(order)}
                  disabled={busyId === order.id}
                >
                  Исполнен
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}

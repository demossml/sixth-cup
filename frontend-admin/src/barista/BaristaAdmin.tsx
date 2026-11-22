import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './barista.css'

const STAFF_TOKEN_KEY = 'barista_staff_token'

type StaffUser = {
  login: string
  role: 'owner' | 'admin' | 'barista'
  storeUuid: string | null
  alertBlink: boolean
  displayName: string | null
}

type KitchenItem = {
  name: string
  qty: number
  mods: string[]
  note: string | null
}

type KitchenOrder = {
  id: string
  queueNumber: number | null
  status: 'new' | 'seen' | 'in_progress' | 'done' | 'cancelled'
  items: KitchenItem[]
  createdAt: number
  seenAt: number | null
  doneAt: number | null
}

function getToken(): string {
  try { return localStorage.getItem(STAFF_TOKEN_KEY) ?? '' } catch { return '' }
}

function setToken(token: string) {
  try { localStorage.setItem(STAFF_TOKEN_KEY, token) } catch { /* private mode */ }
}

function clearToken() {
  try { localStorage.removeItem(STAFF_TOKEN_KEY) } catch { /* private mode */ }
}

class StaffHttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function staffRequest<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/staff${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })
  if (!res.ok) {
    let message = `Ошибка ${res.status}`
    try {
      const body = await res.json() as { error?: string }
      if (body.error) message = body.error
    } catch { /* use status */ }
    throw new StaffHttpError(res.status, message)
  }

  return await res.json() as T
}

function ageLabel(createdAt: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - createdAt) / 60_000))
  if (minutes < 1) return 'только что'
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} ч ${rest} мин назад` : `${hours} ч назад`
}

function itemsText(items: KitchenItem[]): string {
  return items.map((item) => {
    const mods = item.mods.length ? ` (${item.mods.join(', ')})` : ''
    return `${item.name} ×${item.qty}${mods}`
  }).join(' · ')
}

function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submitForm = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/staff/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: login.trim(), password }),
      })
      const body = await res.json().catch(() => ({})) as { token?: string; error?: string }
      if (!res.ok || !body.token) throw new Error(body.error || 'Неверный логин или пароль')
      setToken(body.token)
      onLogin(body.token)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось войти')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="barista-login">
      <form className="barista-login-card" onSubmit={submitForm}>
        <div className="barista-login-brand">6.7 COFFEE</div>
        <h1>Очередь бариста</h1>
        <label className="barista-field">
          <span>Логин</span>
          <input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" required />
        </label>
        <label className="barista-field">
          <span>Пароль</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <p className="barista-error" role="alert">{error}</p>}
        <button type="submit" className="barista-primary" disabled={busy || !login.trim() || !password}>
          {busy ? 'Вход…' : 'Войти'}
        </button>
        <a className="barista-back" href="/">Админка</a>
      </form>
    </main>
  )
}

export default function BaristaAdmin() {
  const [token, setSessionToken] = useState(() => getToken())
  const [user, setUser] = useState<StaffUser | null>(null)
  const [orders, setOrders] = useState<KitchenOrder[]>([])
  const [offline, setOffline] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [alertBlink, setAlertBlink] = useState(true)
  const ordersRef = useRef<KitchenOrder[]>([])

  const logout = useCallback(() => {
    clearToken()
    setSessionToken('')
    setUser(null)
  }, [])

  const refresh = useCallback(async () => {
    if (!token) return
    try {
      const result = await staffRequest<{ orders: KitchenOrder[] }>('/kitchen/orders?status=active', token)
      const next = [...result.orders].sort((a, b) => a.createdAt - b.createdAt)
      const known = new Set(ordersRef.current.map((order) => order.id))
      const hasNew = next.some((order) => !known.has(order.id))
      if (hasNew && alertBlink && typeof navigator.vibrate === 'function') navigator.vibrate([120, 80, 120])
      ordersRef.current = next
      setOrders(next)
      setOffline(false)
    } catch (e) {
      if (e instanceof StaffHttpError && e.status === 401) logout()
      else setOffline(true)
    }
  }, [alertBlink, logout, token])

  useEffect(() => {
    if (!token) return
    let alive = true
    staffRequest<{ user: StaffUser }>('/me', token)
      .then((result) => {
        if (!alive) return
        setUser(result.user)
        setAlertBlink(result.user.alertBlink)
      })
      .catch((e) => {
        if (!alive) return
        if (e instanceof StaffHttpError && (e.status === 401 || e.status === 403)) logout()
      })
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 2000)
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [logout, refresh, token])

  const onLogin = (nextToken: string) => setSessionToken(nextToken)

  const markSeen = async (order: KitchenOrder) => {
    if (order.status !== 'new' || busyId) return
    setBusyId(order.id)
    const next = ordersRef.current.map((item) => item.id === order.id ? { ...item, status: 'seen' as const } : item)
    ordersRef.current = next
    setOrders(next)
    try {
      await staffRequest<{ ok: boolean }>(`/kitchen/orders/${order.id}/seen`, token, { method: 'POST' })
    } catch {
      setOffline(true)
    } finally {
      setBusyId(null)
    }
  }

  const markDone = async (order: KitchenOrder) => {
    if (busyId) return
    setBusyId(order.id)
    const next = ordersRef.current.filter((item) => item.id !== order.id)
    ordersRef.current = next
    setOrders(next)
    try {
      await staffRequest<{ ok: boolean }>(`/kitchen/orders/${order.id}/done`, token, { method: 'POST' })
    } catch {
      void refresh()
      setOffline(true)
    } finally {
      setBusyId(null)
    }
  }

  const toggleBlink = async () => {
    const next = !alertBlink
    setAlertBlink(next)
    try {
      await staffRequest<{ ok: boolean }>('/me', token, {
        method: 'PATCH',
        body: JSON.stringify({ alertBlink: next }),
      })
    } catch (e) {
      setAlertBlink(!next)
      if (e instanceof StaffHttpError && e.status === 401) logout()
    }
  }

  if (!token) return <Login onLogin={onLogin} />

  return (
    <main className="barista-app">
      <header className="barista-head">
        <div>
          <h1>Очередь</h1>
          <p>{user?.displayName || user?.login || 'Сотрудник'}</p>
        </div>
        <div className="barista-head-actions">
          <label className="barista-toggle">
            <input type="checkbox" checked={alertBlink} onChange={toggleBlink} />
            <span>Моргание</span>
          </label>
          <button type="button" className="barista-logout" onClick={logout}>Выйти</button>
        </div>
      </header>
      {offline && <div className="barista-banner" role="status">Нет сети — показаны последние полученные заказы</div>}
      {orders.length === 0 ? (
        <div className="barista-empty">
          <strong>Заказов нет</strong>
          <span>Новый заказ появится после создания кассой</span>
        </div>
      ) : (
        <ul className="barista-grid">
          {orders.map((order) => (
            <li key={order.id} className={`barista-card${order.status === 'new' && alertBlink ? ' is-blinking' : ''}`}>
              <button
                type="button"
                className="barista-card-body"
                onClick={() => void markSeen(order)}
                disabled={order.status !== 'new'}
              >
                <span className="barista-card-top">
                  <span className="barista-number">№{order.queueNumber ?? '—'}</span>
                  <span className={`barista-status status-${order.status}`}>
                    {order.status === 'new' ? 'Новый' : order.status === 'seen' ? 'Принят' : 'Готовится'}
                  </span>
                </span>
                <span className="barista-age">{ageLabel(order.createdAt)}</span>
                <span className="barista-items">{itemsText(order.items)}</span>
                {order.items.some((item) => item.note) && (
                  <span className="barista-note">
                    {order.items.filter((item) => item.note).map((item) => `${item.name}: ${item.note}`).join(' · ')}
                  </span>
                )}
              </button>
              <button
                type="button"
                className="barista-done"
                onClick={() => void markDone(order)}
                disabled={busyId === order.id}
              >
                Исполнен
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

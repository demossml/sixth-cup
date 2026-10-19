import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { api, setUnauthorizedHandler, tokenStore } from './api/client'
import { MetaCtx } from './meta'
import type { Meta } from './meta'
import Shell from './layout/Shell'
import { Button, Input, ToastProvider, Spinner } from './ui/kit'
const AdminPage = lazy(() => import('./pages/AdminPage'))
const Today = lazy(() => import('./pages/Today'))
const Operations = lazy(() => import('./pages/Operations'))
const Customers = lazy(() => import('./pages/Customers'))
const CustomerCard = lazy(() => import('./pages/CustomerCard'))
const Menu = lazy(() => import('./pages/Menu'))
const Cash = lazy(() => import('./pages/Cash'))
const Marketing = lazy(() => import('./pages/Marketing'))
const Referrals = lazy(() => import('./pages/Referrals'))
const Compare = lazy(() => import('./pages/Compare'))
const BusinessEvents = lazy(() => import('./pages/BusinessEvents'))
const Assistant = lazy(() => import('./pages/Assistant'))
const System = lazy(() => import('./pages/System'))
const Staff = lazy(() => import('./pages/Staff'))
const Stock = lazy(() => import('./pages/Stock'))
const Purchases = lazy(() => import('./pages/Purchases'))
const Inventory = lazy(() => import('./pages/Inventory'))
const Analytics = lazy(() => import('./pages/Analytics'))
const Help = lazy(() => import('./pages/Help'))


function Login({ onOk }: { onOk: (m: Meta) => void }) {
  const [token, setToken] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    tokenStore.set(token.trim())
    try {
      onOk(await api<Meta>('/meta'))
    } catch {
      tokenStore.clear()
      setErr('Неверный токен или сервер недоступен')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-page p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-card">
        <div className="mb-4 flex items-center gap-3">
          <img src="/67coffee-mark.png" alt="" className="h-10 w-10 rounded-[10px]" />
          <div>
            <h1 className="text-lg font-extrabold text-ink">6.7 Coffee</h1>
            <p className="font-mono text-[10px] uppercase tracking-wider text-ink-tertiary">Админка</p>
          </div>
        </div>
        <p className="mb-3 text-[13px] text-ink-secondary">Введите токен администратора</p>
        <Input type="password" autoFocus value={token} onChange={(e) => setToken(e.target.value)} placeholder="Токен" aria-label="Токен администратора" />
        {err && <p role="alert" className="mt-2 text-sm text-bad">{err}</p>}
        <Button type="submit" className="mt-3 w-full" loading={busy} disabled={!token.trim()}>Войти</Button>
      </form>
    </div>
  )
}

export default function App() {
  const [state, setState] = useState<'checking' | 'out' | 'in'>(tokenStore.get() ? 'checking' : 'out')
  const [meta, setMeta] = useState<Meta>({ production: true, resetAllowed: false })
  const logout = useCallback(() => { tokenStore.clear(); setState('out') }, [])

  useEffect(() => {
    setUnauthorizedHandler(logout)
    return () => setUnauthorizedHandler(null)
  }, [logout])

  useEffect(() => {
    if (state !== 'checking') return
    api<Meta>('/meta').then((m) => { setMeta(m); setState('in') }).catch(() => setState('out'))
  }, [state])

  if (state === 'checking') return <Spinner />
  if (state === 'out') return <Login onOk={(m) => { setMeta(m); setState('in') }} />
  return (
    <MetaCtx.Provider value={meta}>
      <ToastProvider>
        <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/legacy" element={<AdminPage />} />
          <Route element={<Shell onLogout={logout} />}>
            <Route index element={<Today />} />
            <Route path="operations" element={<Operations />} />
            <Route path="customers" element={<Customers />} />
            <Route path="customers/:id" element={<CustomerCard />} />
            <Route path="menu" element={<Menu />} />
            <Route path="cash" element={<Cash />} />
            <Route path="marketing" element={<Marketing />} />
            <Route path="referrals" element={<Referrals />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="compare" element={<Compare />} />
            <Route path="events" element={<BusinessEvents />} />
            <Route path="assistant" element={<Assistant />} />
            <Route path="system" element={<System />} />
            <Route path="help" element={<Help />} />
            <Route path="staff" element={<Staff />} />
            <Route path="stock" element={<Stock />} />
            <Route path="purchases" element={<Purchases />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
        </Suspense>
      </ToastProvider>
    </MetaCtx.Provider>
  )
}

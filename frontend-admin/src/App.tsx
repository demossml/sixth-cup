import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { api, setUnauthorizedHandler, tokenStore } from './api/client'
import { MetaCtx } from './meta'
import type { Meta } from './meta'
import Shell from './layout/Shell'
import { Button, Input, ToastProvider, Spinner } from './ui/kit'
import AdminPage from './pages/AdminPage'
import Today from './pages/Today'
import Operations from './pages/Operations'
import Customers from './pages/Customers'
import CustomerCard from './pages/CustomerCard'
import Menu from './pages/Menu'
import Cash from './pages/Cash'
import Marketing from './pages/Marketing'
import System from './pages/System'


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
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-line bg-white p-6 shadow-card">
        <h1 className="text-xl font-bold text-brand">6.7 Coffee · Админка</h1>
        <p className="mb-4 mt-1 text-sm text-ink-secondary">Введите токен администратора</p>
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
            <Route path="system" element={<System />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </ToastProvider>
    </MetaCtx.Provider>
  )
}

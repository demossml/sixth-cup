import { useState } from 'react'
import { setAdminToken, adminFetch } from '../api/client'

export function Login({ onOk }: { onOk: () => void }) {
  const [token, setToken] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setErr('')
    setAdminToken(token.trim())
    try {
      await adminFetch('/overview')
      onOk()
    } catch (ex: any) {
      setErr(ex.message ?? 'Ошибка входа')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-white border border-line p-6 shadow-sm space-y-3">
        <h1 className="text-lg font-bold text-brand">6.7 Coffee — админ</h1>
        <p className="text-sm text-ink-secondary">Введите ADMIN_TOKEN</p>
        <input
          className="w-full rounded-xl border border-line px-3 py-2 text-sm"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="токен"
          autoFocus
        />
        {err ? <p className="text-sm text-red-600">{err}</p> : null}
        <button type="submit" disabled={loading || !token.trim()} className="w-full rounded-xl bg-brand text-white py-2.5 text-sm font-medium disabled:opacity-50">
          {loading ? '…' : 'Войти'}
        </button>
      </form>
    </div>
  )
}

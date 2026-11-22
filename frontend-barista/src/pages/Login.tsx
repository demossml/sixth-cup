import { useState } from 'react'
import { login } from '../api'

/** Вход бариста: только логин и пароль, без «регистрации» и восстановления по SMS. */
export default function LoginPage({ onLogin }: { onLogin: (token: string) => void }) {
  const [loginValue, setLoginValue] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!loginValue.trim() || !password) return
    setBusy(true)
    setError('')
    try {
      const res = await login(loginValue.trim(), password)
      onLogin(res.token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось войти')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">6.7 Coffee</div>
        <h1>Очередь заказов</h1>
        <label className="field">
          <span>Логин</span>
          <input
            value={loginValue}
            onChange={(e) => setLoginValue(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="text"
            required
          />
        </label>
        <label className="field">
          <span>Пароль</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn-primary" disabled={busy || !loginValue.trim() || !password}>
          {busy ? 'Вход…' : 'Войти'}
        </button>
        <p className="hint">Логин выдаёт администратор точки.</p>
      </form>
    </main>
  )
}

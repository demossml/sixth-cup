import { useCallback, useState } from 'react'
import { tokenStore } from './api'
import LoginPage from './pages/Login'
import QueuePage from './pages/Queue'

export default function App() {
  const [token, setToken] = useState(() => tokenStore.get())

  const onLogin = useCallback((next: string) => {
    tokenStore.set(next)
    setToken(next)
  }, [])

  const onLogout = useCallback(() => {
    tokenStore.clear()
    setToken('')
  }, [])

  // `key` — чтобы при смене пользователя очередь и её опрос начинались заново.
  // .app-col — колонка приложения: на десктопе она превращается в рамку устройства (Steel §8.1).
  return (
    <div className="app-col">
      {token ? <QueuePage key={token} onLogout={onLogout} /> : <LoginPage onLogin={onLogin} />}
    </div>
  )
}

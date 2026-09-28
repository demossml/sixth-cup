import { Link, useNavigate } from 'react-router-dom'
import Qr from '../components/Qr'
import { setJwt } from '../api'
import { useApp } from '../lib/app'
import { clearUserData } from '../lib/db'
import { isDev } from '../lib/dev'

export default function ProfilePage() {
  const { me, lastSync, syncing, sync, reload } = useApp()
  const nav = useNavigate()
  const link = me ? `${location.origin}/?invite=${me.inviteCode}` : ''

  async function share() {
    if (navigator.share) await navigator.share({ title: 'Шестой стакан', text: 'Копи стаканы — каждый 6-й бесплатно! И получай 3% с покупок друзей.', url: link })
    else await navigator.clipboard?.writeText(link)
  }

  async function logout() {
    setJwt(null)
    await clearUserData()
    await reload()
    nav('/login')
  }

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold">{me?.nickname ?? 'Профиль'}</h1>
      <p className="text-muted text-sm mt-1">
        Последняя синхронизация: {lastSync ? new Date(lastSync).toLocaleString() : 'ещё не было'}
      </p>
      {me && me.cashbackBalance > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center my-3">
          💰 Твой кэшбэк: <b>{me.cashbackBalance} ₽</b>
        </div>
      )}
      <button className="btn-ghost" disabled={syncing} onClick={() => sync()}>🔄 Синхронизировать</button>

      <h2 className="text-base font-semibold mt-5 mb-2">Приведи друга — получай 3%</h2>
      <p className="text-muted text-sm mb-2">Друг регистрируется по твоей ссылке или QR. С каждой его покупки тебе 3% кэшбэком. Навсегда.</p>
      {link && (
        <>
          <Qr value={link} />
          <input className="input text-sm" readOnly value={link} onFocus={(e) => e.target.select()} />
          <button className="btn" onClick={share}>Поделиться</button>
        </>
      )}

      <h2 className="text-base font-semibold mt-5 mb-2">Для сотрудников</h2>
      <Link to="/cashier" className="text-brand font-medium">Режим кассы →</Link>
      {isDev && <div className="mt-1"><Link to="/dev" className="text-brand font-medium">🧪 Режим разработчика →</Link></div>}

      <button className="btn-danger mt-6" onClick={logout}>Выйти</button>
    </div>
  )
}

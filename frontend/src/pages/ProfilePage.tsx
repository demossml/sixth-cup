import { Link, useNavigate } from 'react-router-dom'
import Qr from '../components/Qr'
import { setJwt } from '../api'
import { useApp } from '../lib/app'
import { clearUserData } from '../lib/db'
import { isDev } from '../lib/dev'
import { ChevronLeft, LogOut, RefreshCw, Share2, Store, Users, Wallet } from '../lib/icons'

export default function ProfilePage() {
  const { me, lastSync, syncing, sync, reload } = useApp()
  const nav = useNavigate()
  const link = me ? `${location.origin}/?invite=${me.inviteCode}` : ''

  async function share() {
    if (navigator.share) {
      await navigator.share({
        title: 'Шестой стакан',
        text: 'Копи стаканы — каждый 6-й бесплатно. И получай 3% с покупок друзей.',
        url: link,
      })
    } else {
      await navigator.clipboard?.writeText(link)
    }
  }

  async function logout() {
    setJwt(null)
    await clearUserData()
    await reload()
    nav('/login')
  }

  return (
    <div className="pb-4">
      <div className="bg-brand text-white px-4 pt-10 pb-6 rounded-b-3xl">
        <h1 className="text-xl font-bold">{me?.nickname ?? 'Профиль'}</h1>
        <p className="text-white/70 text-xs mt-1">
          Синхронизация: {lastSync ? new Date(lastSync).toLocaleString() : 'ещё не было'}
        </p>
        {me && me.cashbackBalance > 0 && (
          <div className="mt-3 inline-flex items-center gap-2 bg-white/15 rounded-xl px-3 py-2">
            <Wallet size={16} />
            <span className="text-sm font-semibold">Кэшбэк {me.cashbackBalance} ₽</span>
          </div>
        )}
      </div>

      <div className="px-4 pt-4">
        <button className="btn-ghost flex items-center justify-center gap-2" disabled={syncing} onClick={() => sync()}>
          <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
          Синхронизировать
        </button>

        <h2 className="text-sm font-semibold text-ink mt-6 mb-2 flex items-center gap-1.5">
          <Users size={16} className="text-brand" /> Приведи друга — 3%
        </h2>
        <p className="text-ink-secondary text-sm mb-3 leading-relaxed">
          Друг регистрируется по ссылке или QR. С каждой его покупки тебе начисляется 3% кэшбэком. Навсегда.
        </p>
        {link && (
          <div className="card text-center">
            <Qr value={link} />
            <input className="input text-xs mt-2" readOnly value={link} onFocus={(e) => e.target.select()} />
            <button className="btn flex items-center justify-center gap-2" onClick={share}>
              <Share2 size={16} /> Поделиться
            </button>
          </div>
        )}

        <h2 className="text-sm font-semibold text-ink mt-6 mb-2 flex items-center gap-1.5">
          <Store size={16} className="text-brand" /> Для сотрудников
        </h2>
        <Link to="/cashier" className="card flex items-center justify-between no-underline text-ink">
          <span className="text-sm font-medium">Режим кассы</span>
          <ChevronLeft size={18} className="rotate-180 text-ink-tertiary" />
        </Link>
        <Link to="/admin" className="card flex items-center justify-between no-underline text-ink !mb-0">
          <span className="text-sm font-medium">Админ-панель</span>
          <ChevronLeft size={18} className="rotate-180 text-ink-tertiary" />
        </Link>
        {isDev && (
          <Link to="/dev" className="card flex items-center justify-between no-underline text-ink !mb-0 mt-2.5">
            <span className="text-sm font-medium">Режим разработчика</span>
            <ChevronLeft size={18} className="rotate-180 text-ink-tertiary" />
          </Link>
        )}

        <button className="btn-danger mt-8 flex items-center justify-center gap-2" onClick={logout}>
          <LogOut size={16} /> Выйти
        </button>
      </div>
    </div>
  )
}

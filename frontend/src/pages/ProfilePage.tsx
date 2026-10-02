import { useNavigate } from 'react-router-dom'
import Qr from '../components/Qr'
import { setJwt } from '../api'
import { useApp } from '../lib/app'
import { clearUserData } from '../lib/db'
import { LogOut, RefreshCw, Share2, Users, Wallet } from '../lib/icons'

export default function ProfilePage() {
  const { me, lastSync, syncing, sync, reload } = useApp()
  const nav = useNavigate()
  const link = me ? `${location.origin}/?invite=${me.inviteCode}` : ''

  async function share() {
    if (navigator.share) {
      await navigator.share({
        title: '6.7 Coffee',
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
        <button type="button" className="btn flex items-center justify-center gap-2 mb-2" onClick={() => nav('/invite')}>
          <Users size={16} /> Приведи друга — QR
        </button>
        <button type="button" className="btn-ghost flex items-center justify-center gap-2" disabled={syncing} onClick={() => void sync()}>
          <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
          Синхронизировать
        </button>
<button className="btn-danger mt-8 flex items-center justify-center gap-2" onClick={logout}>
          <LogOut size={16} /> Выйти
        </button>
      </div>
    </div>
  )
}

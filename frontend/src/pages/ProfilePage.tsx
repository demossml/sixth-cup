import { useNavigate } from 'react-router-dom'
import { setJwt } from '../api'
import { useApp } from '../lib/app'
import { clearUserData } from '../lib/db'
import { LogOut, RefreshCw, Users, Wallet, QrCode } from '../lib/icons'

export default function ProfilePage() {
  const { me, referrals, lastSync, syncing, sync, reload } = useApp()
  const nav = useNavigate()

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
        <button className="card w-full text-left flex items-center gap-3" onClick={() => nav('/invite')}>
          <div className="w-10 h-10 rounded-xl bg-brand-soft flex items-center justify-center"><QrCode size={20} className="text-brand" /></div>
          <div className="flex-1"><b className="text-sm">Пригласить друга</b><p className="text-xs text-ink-secondary mt-0.5">Покажите свой QR и получайте 3% с покупок друзей</p></div>
        </button>

        <div className="card mt-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center"><Users size={20} className="text-accent-green" /></div>
            <div><div className="text-xs text-ink-secondary">Кэшбэк от друзей</div><div className="text-xl font-bold">+{referrals.friendCashbackTotal} ₽</div><div className="text-xs text-ink-tertiary">Приглашено друзей: {referrals.friendCount}</div></div>
          </div>
        </div>

        <button className="card mt-3 w-full text-left flex items-center gap-3" onClick={() => nav('/save-account')}>
          <div className="w-10 h-10 rounded-xl bg-brand-soft flex items-center justify-center"><QrCode size={20} className="text-brand" /></div>
          <div><b className="text-sm">Сохранить аккаунт</b><p className="text-xs text-ink-secondary mt-0.5">Создать QR для восстановления</p></div>
        </button>

        <button className="btn-ghost mt-3 flex items-center justify-center gap-2" disabled={syncing} onClick={() => sync()}>
          <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} /> Синхронизировать
        </button>
        <button className="btn-danger mt-8 flex items-center justify-center gap-2" onClick={logout}>
          <LogOut size={16} /> Выйти
        </button>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ScanModal from '../components/ScanModal'
import { api, unwrap } from '../api'
import Qr from '../components/Qr'
import { setJwt } from '../api'
import { ensureGuest, restoreAccount } from '../lib/ensureGuest'
import { useApp } from '../lib/app'
import { clearUserData } from '../lib/db'
import { LogOut, RefreshCw, Share2, Users, Wallet } from '../lib/icons'

export default function ProfilePage() {
  const { me, lastSync, syncing, sync, reload } = useApp()
  const nav = useNavigate()
  const [recovery, setRecovery] = useState('')
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [restoreText, setRestoreText] = useState('')
  const [note, setNote] = useState('')
  const [scan, setScan] = useState(false)
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

  async function makeRecovery() {
    try {
      const r = await unwrap(api.api.auth.recovery.$post()) as { recovery: string }
      setRecovery(r.recovery)
      localStorage.setItem('sc-saved', '1')
    } catch { setNote('Нужен интернет, чтобы создать код сохранения.') }
  }

  async function downloadRecovery() {
    const QRCode = (await import('qrcode')).default
    const url = await QRCode.toDataURL(recovery, { errorCorrectionLevel: 'M', margin: 3, width: 480 })
    const a = document.createElement('a')
    a.href = url; a.download = '6-7-coffee-account.png'; a.click()
  }

  async function doRestore(code: string) {
    setScan(false)
    if (await restoreAccount(code.trim())) {
      localStorage.setItem('sc-saved', '1')
      await clearUserData()
      await reload(); await sync(); nav('/')
    } else setNote('Не удалось восстановить: неверный код.')
  }

  async function logout() {
    if (!confirm('Сбросить карту на этом устройстве? Без сохранённого QR восстановления кэшбэк и стаканы станут недоступны. Лучше не выходить.')) return
    if (!confirm('Точно создать новую пустую карту?')) return
    setJwt(null)
    await clearUserData()
    localStorage.removeItem('sc-guest-nonce')
    await ensureGuest()
    await reload()
    nav('/')
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
            <span className="text-sm font-semibold">Кэшбэк {Math.floor(me.cashbackBalance / 100)} ₽</span>
          </div>
        )}
        {me?.cardCode && (
          <div className="mt-3 rounded-xl bg-white/10 px-3 py-2">
            <div className="text-white/70 text-xs">Номер карты</div>
            <div className="text-2xl font-bold tracking-[0.2em] tabular-nums">{me.cardCode.padStart(4, '0')}</div>
          </div>
        )}
      </div>

      <div className="px-4 pt-4">
        <button type="button" className="btn flex items-center justify-center gap-2 mb-2" onClick={() => nav('/invite')}>
          <Users size={16} /> Пригласить друга — QR
        </button>
        <button type="button" className="btn-ghost flex items-center justify-center gap-2" disabled={syncing} onClick={() => void sync()}>
          <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
          Синхронизировать
        </button>
<button className="btn-danger mt-8 flex items-center justify-center gap-2" onClick={logout}>
          <LogOut size={16} /> Сбросить карту на устройстве
        </button>
      </div>
    </div>
  )
}

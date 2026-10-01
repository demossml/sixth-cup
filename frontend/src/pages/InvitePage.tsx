import { useNavigate } from 'react-router-dom'
import Qr from '../components/Qr'
import { useApp } from '../lib/app'
import { ChevronLeft, Share2, Users } from '../lib/icons'

export default function InvitePage() {
  const { me } = useApp()
  const nav = useNavigate()
  if (!me) return null

  const url = `${location.origin}/?invite=${encodeURIComponent(me.inviteCode)}`

  async function share() {
    if (navigator.share) {
      await navigator.share({
        title: '6.7 Coffee',
        text: 'Присоединяйся к 6.7 Coffee — каждый 6-й стакан бесплатно.',
        url,
      })
    } else {
      await navigator.clipboard?.writeText(url)
    }
  }

  return (
    <div className="pb-8">
      <div className="bg-brand text-white px-4 pt-8 pb-6 rounded-b-3xl">
        <button className="flex items-center gap-1 text-white/80 text-sm mb-4" onClick={() => nav(-1)}>
          <ChevronLeft size={18} /> Назад
        </button>
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-white/15 flex items-center justify-center"><Users size={24} /></div>
          <div>
            <h1 className="text-xl font-bold">Пригласить друга</h1>
            <p className="text-white/75 text-sm mt-1">Друг получит 3% кэшбэка.</p>
          </div>
        </div>
      </div>

      <div className="px-4 pt-5">
        <div className="card text-center">
          <p className="text-sm font-semibold text-ink">Покажите этот QR-код другу</p>
          <p className="text-xs text-ink-secondary mt-1">После сканирования аккаунт создастся автоматически.</p>
          <div className="flex justify-center py-5"><Qr value={url} /></div>
          <button className="btn flex items-center justify-center gap-2" onClick={share}>
            <Share2 size={18} /> Поделиться
          </button>
        </div>

        <div className="card mt-3 bg-brand-soft border-brand/20">
          <b className="text-sm text-brand">Ваш бонус</b>
          <p className="text-sm text-ink-secondary mt-1">Получайте кэшбэк с покупок приглашённых друзей. В профиле показывается только общая сумма, без имён и деталей отдельных друзей.</p>
        </div>
      </div>
    </div>
  )
}

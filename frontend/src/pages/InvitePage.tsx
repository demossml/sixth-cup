import { useNavigate } from 'react-router-dom'
import Qr from '../components/Qr'
import { useApp } from '../lib/app'
import { Share2, Users } from '../lib/icons'

export default function InvitePage() {
  const { me, dir } = useApp()
  const nav = useNavigate()
  const pct = dir?.referralCashbackPercent ?? 3
  const link = me ? `${location.origin}/?invite=${encodeURIComponent(me.inviteCode)}` : ''

  async function share() {
    if (!link) return
    if (navigator.share) {
      await navigator.share({
        title: '6.7 Coffee',
        text: `Присоединяйся к 6.7 Coffee. Каждый 6-й кофе бесплатно. По этой ссылке ты в программе лояльности.`,
        url: link,
      })
    } else {
      await navigator.clipboard?.writeText(link)
      alert('Ссылка скопирована')
    }
  }

  if (!me) {
    return (
      <div className="p-4">
        <p className="text-ink-secondary text-sm">Сначала откройте карту — аккаунт создаётся автоматически.</p>
        <button type="button" className="btn mt-3" onClick={() => nav('/')}>На главную</button>
      </div>
    )
  }

  return (
    <div className="pb-8">
      <div className="bg-brand text-white px-4 pt-10 pb-6 rounded-b-3xl">
        <button type="button" className="text-white/80 text-sm mb-2" onClick={() => nav(-1)}>← Назад</button>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center">
            <Users size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold">Пригласить друга</h1>
            <p className="text-white/75 text-sm mt-0.5">Вы получаете {pct}% с его покупок</p>
          </div>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-4">
        <div className="card text-center">
          <p className="text-sm font-semibold text-ink mb-1">Покажите QR другу</p>
          <p className="text-xs text-ink-secondary mb-2">
            Пусть отсканирует камерой телефона — откроется приложение и привяжется к вашему приглашению.
          </p>
          <Qr value={link} />
          <p className="text-[11px] text-ink-tertiary break-all mt-1 px-2">{link}</p>
        </div>

        <div className="card space-y-2 text-sm text-ink-secondary">
          <p className="font-semibold text-ink text-[15px]">Как это работает</p>
          <ol className="list-decimal pl-4 space-y-1.5">
            <li>Друг сканирует QR или открывает ссылку.</li>
            <li>У него появляется своя карта лояльности (без лишней регистрации).</li>
            <li>Он копит стаканы: каждый 6-й кофе — бесплатно.</li>
            <li>С каждой его оплаты вам навсегда начисляется <b className="text-ink">{pct}% кэшбэка</b>.</li>
            <li>Кэшбэк можно списать на кассе при следующей покупке.</li>
          </ol>
        </div>

        <button type="button" className="btn flex items-center justify-center gap-2" onClick={() => void share()}>
          <Share2 size={18} /> Поделиться ссылкой
        </button>
      </div>
    </div>
  )
}

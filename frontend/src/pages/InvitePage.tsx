import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Qr from '../components/Qr'
import { useApp } from '../lib/app'
import { Share2, Users } from '../lib/icons'

export default function InvitePage() {
  const { me, dir } = useApp()
  const nav = useNavigate()
  const [copied, setCopied] = useState(false)
  const pct = dir?.referralCashbackPercent ?? 3
  const link = me ? `${location.origin}/?invite=${encodeURIComponent(me.inviteCode)}` : ''

  async function share() {
    if (!link) return
    if (navigator.share) {
      try { await navigator.share({
        title: '6.7 Coffee',
        text: `Присоединяйся к 6.7 Coffee. Каждый 6-й кофе бесплатно. По этой ссылке ты в программе лояльности.`,
        url: link,
      }) } catch { /* пользователь закрыл меню «Поделиться» */ }
    } else {
      await navigator.clipboard?.writeText(link)
      setCopied(true)
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
      <div className="hero text-white px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-6 rounded-b-3xl">
        <button type="button" className="text-white/90 text-sm mb-2 min-h-11" onClick={() => nav(-1)}>← Назад</button>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center">
            <Users size={24} />
          </div>
          <div>
            <h1 className="text-[22px] leading-7 font-semibold">Пригласить друга</h1>
            <p className="text-brand-sub text-sm mt-0.5">Вы получаете {pct}% с его покупок</p>
          </div>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-4">
        {/* Приглашение выглядит как билет с кремовой рамкой — не спутать с картой (белый квадрат с QR). */}
        <div className="bg-white rounded-2xl p-4 text-center border-2 border-dashed border-brand-mid shadow-card">
          <p className="inline-block text-[12px] leading-4 font-semibold tracking-wide text-warn bg-warn-bg rounded-full px-3 py-1.5 mb-2">
            Приглашение · не для кассы
          </p>
          <p className="text-sm font-semibold text-ink mb-1">QR приглашения — покажите другу</p>
          <p className="text-xs text-ink-secondary mb-1">
            Это не QR карты: кассе его показывать не нужно. QR для кассы — на главном экране.
          </p>
          <p className="text-xs text-ink-secondary mb-2">
            Пусть отсканирует камерой телефона — откроется приложение и привяжется к вашему приглашению.
          </p>
          <Qr value={link} size={240} alt="QR приглашения друга" />
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

        <button type="button" className="btn min-h-12 flex items-center justify-center gap-2" onClick={() => void share()}>
          <Share2 size={18} /> Поделиться ссылкой
        </button>
        {copied && <p className="text-sm text-ok text-center">Ссылка скопирована</p>}
      </div>
    </div>
  )
}

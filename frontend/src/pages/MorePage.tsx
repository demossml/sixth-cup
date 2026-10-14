import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ru } from '../copy/ru'
import { vibrationEnabled, setVibrationEnabled } from '../lib/haptics'
import { ChevronRight, History, UserRound, Ticket, Store, Users, Coffee, FileText, Smartphone } from '../lib/icons'

const entries = [
  { to: '/history', title: ru.more.history, detail: ru.more.historyDetail, Icon: History },
  { to: '/me', title: ru.more.profile, detail: ru.more.profileDetail, Icon: UserRound },
  { to: '/promos', title: ru.more.promos, detail: ru.more.promosDetail, Icon: Ticket },
  { to: '/stores', title: ru.more.stores, detail: ru.more.storesDetail, Icon: Store },
  { to: '/game', title: ru.more.game, detail: ru.more.gameDetail, Icon: Coffee },
  { to: '/invite', title: ru.more.invite, detail: ru.more.inviteDetail, Icon: Users },
  { to: '/legal', title: ru.more.legal, detail: ru.more.legalDetail, Icon: FileText },
]

export default function MorePage() {
  const [vib, setVib] = useState(() => vibrationEnabled())
  return (
    <div className="pb-6">
      <header className="px-4 pb-3" style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))' }}>
        <h1 className="text-[22px] leading-7 font-semibold text-ink">Ещё</h1>
      </header>
      <div className="px-4 space-y-3">
        <div className="bg-white border border-line rounded-2xl shadow-card divide-y divide-line overflow-hidden">
          {entries.map(({ to, title, detail, Icon }) => (
            <Link key={to} to={to} className="flex items-center gap-3 px-3.5 py-3 min-h-14 no-underline active:bg-brand-tint/60">
              <Icon size={20} strokeWidth={1.75} className="text-brand shrink-0" />
              <span className="flex-1 min-w-0">
                <b className="block text-ink text-[15px] font-semibold">{title}</b>
                <small className="block text-ink-secondary text-[13px] leading-[18px] mt-0.5">{detail}</small>
              </span>
              <ChevronRight className="text-ink-tertiary shrink-0" size={18} strokeWidth={1.75} />
            </Link>
          ))}
        </div>
        <div className="bg-white border border-line rounded-2xl shadow-card overflow-hidden">
          <button type="button" className="flex items-center gap-3 px-3.5 py-3 min-h-14 w-full text-left active:bg-brand-tint/60"
            onClick={() => { const next = !vib; setVibrationEnabled(next); setVib(next) }}>
            <Smartphone size={20} strokeWidth={1.75} className="text-brand shrink-0" />
            <span className="flex-1 min-w-0">
              <b className="block text-ink text-[15px] font-semibold">{ru.more.vibration}</b>
              <small className="block text-ink-secondary text-[13px] leading-[18px] mt-0.5">{ru.more.vibrationDetail}</small>
            </span>
            <span className={`text-[13px] font-semibold ${vib ? 'text-ok' : 'text-ink-tertiary'}`}>{vib ? 'Вкл' : 'Выкл'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

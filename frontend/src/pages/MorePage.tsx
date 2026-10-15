import BrandLogo from '../components/BrandLogo'
import { Link } from 'react-router-dom'
import { useApp } from '../lib/app'
import { formatCardCode } from '../lib/card'
import { ru } from '../copy/ru'
import { ChevronRight, History, UserRound, Ticket, Store, Users, Coffee, FileText, Info } from '../lib/icons'

type Row = { to: string; title: string; detail: string; Icon: typeof History }

export default function MorePage() {
  const { me, dir } = useApp()
  const pct = dir?.referralCashbackPercent ?? 3
  const groups: Row[][] = [
    [
      { to: '/history', title: ru.more.history, detail: ru.more.historyDetail, Icon: History },
      { to: '/me', title: ru.more.profile, detail: ru.more.profileDetail, Icon: UserRound },
      { to: '/invite', title: ru.more.invite, detail: `Кэшбэк ${pct}% · ссылка не для кассы`, Icon: Users },
    ],
    [
      { to: '/stores', title: ru.more.stores, detail: ru.more.storesDetail, Icon: Store },
      { to: '/promos', title: ru.more.promos, detail: ru.more.promosDetail, Icon: Ticket },
      { to: '/game', title: ru.more.game, detail: ru.more.gameDetail, Icon: Coffee },
    ],
    [
      { to: '/about', title: ru.more.about, detail: ru.more.aboutDetail, Icon: Info },
      { to: '/legal', title: ru.more.legal, detail: ru.more.legalDetail, Icon: FileText },
    ],
  ]
  return (
    <div className="pb-6">
      <header className="px-4 pb-3" style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))' }}>
        <h1 className="text-[24px] leading-8 font-semibold text-ink">Ещё</h1>
      </header>
      <div className="px-4 space-y-3">
        <Link to="/me" className="flex items-center gap-3 px-3.5 py-3 min-h-16 no-underline bg-white border border-line rounded-2xl shadow-card active:bg-brand-tint/60">
          <img src="/logo-mark.png" alt="" width={44} height={44} className="w-11 h-11 rounded-full bg-brand shrink-0" />
          <span className="flex-1 min-w-0">
            <b className="block text-ink text-[15px] font-semibold">Моя карта</b>
            <small className="block text-ink-secondary text-[13px] leading-[18px] num">Карта № {formatCardCode(me?.cardCode)}</small>
          </span>
          <ChevronRight className="text-ink-tertiary shrink-0" size={18} strokeWidth={1.75} />
        </Link>
        {groups.map((g, gi) => (
          <div key={gi} className="bg-white border border-line rounded-2xl shadow-card divide-y divide-line overflow-hidden">
            {g.map(({ to, title, detail, Icon }) => (
              <Link key={to} to={to} className="flex items-center gap-3 px-3.5 py-2.5 min-h-14 no-underline active:bg-brand-tint/60">
                <Icon size={20} strokeWidth={1.75} className="text-brand shrink-0" />
                <span className="flex-1 min-w-0">
                  <b className="block text-ink text-[14px] leading-5 font-semibold">{title}</b>
                  <small className="block text-ink-secondary text-[12px] leading-4 mt-0.5">{detail}</small>
                </span>
                <ChevronRight className="text-ink-tertiary shrink-0" size={16} strokeWidth={1.75} />
              </Link>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

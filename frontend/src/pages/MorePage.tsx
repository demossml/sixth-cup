import { Link } from 'react-router-dom'
import { ChevronRight, History, UserRound, Ticket, Store, Users, Coffee } from '../lib/icons'

const entries = [
  { to: '/history', title: 'История', detail: 'Подтверждённые покупки и начисления', Icon: History },
  { to: '/me', title: 'Профиль и восстановление', detail: 'Номер карты, код восстановления', Icon: UserRound },
  { to: '/promos', title: 'Акции', detail: 'Предложения 6.7 Coffee', Icon: Ticket },
  { to: '/stores', title: 'Кофейни', detail: 'Адреса', Icon: Store },
  { to: '/invite', title: 'Пригласить друга', detail: 'Ссылка и QR для друга — не для кассы', Icon: Users },
  { to: '/game', title: 'Собери альпаку', detail: 'Мини-игра · бонус 1 раз в день после синка', Icon: Coffee },
]

/** «Ещё»: одна сгруппированная белая плашка с hairline вместо стопки равновеликих карточек. */
export default function MorePage() {
  return (
    <div className="pb-6">
      <header className="px-4 pb-3" style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))' }}>
        <h1 className="text-[22px] leading-7 font-semibold text-ink">Ещё</h1>
      </header>
      <div className="px-4">
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
      </div>
    </div>
  )
}

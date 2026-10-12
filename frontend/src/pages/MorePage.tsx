import { Link } from 'react-router-dom'
import { ChevronRight, History, UserRound, Ticket, Store, Users } from '../lib/icons'

const entries = [
  { to: '/history', title: 'История', detail: 'Подтверждённые покупки и начисления', Icon: History },
  { to: '/me', title: 'Профиль и восстановление', detail: 'Номер карты, код восстановления', Icon: UserRound },
  { to: '/promos', title: 'Акции', detail: 'Предложения 6.7 Coffee', Icon: Ticket },
  { to: '/stores', title: 'Кофейни', detail: 'Адреса', Icon: Store },
  { to: '/invite', title: 'Пригласить друга', detail: 'Ссылка и QR для друга — не для кассы', Icon: Users },
]
export default function MorePage() {
  return <div className="pb-6">
    <header className="bg-white px-4 pb-5 border-b border-line" style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))' }}><h1 className="text-2xl font-bold text-ink">Ещё</h1></header>
    <div className="p-4 space-y-2">{entries.map(({to,title,detail,Icon}) => <Link key={to} to={to} className="card !mb-0 flex items-center gap-3 no-underline min-h-14">
      <span className="w-11 h-11 rounded-xl bg-brand-soft text-brand flex items-center justify-center shrink-0"><Icon size={21}/></span><span className="flex-1 min-w-0"><b className="block text-ink text-sm">{title}</b><small className="block text-ink-secondary mt-0.5">{detail}</small></span><ChevronRight className="text-ink-tertiary shrink-0" size={18}/>
    </Link>)}</div>
  </div>
}

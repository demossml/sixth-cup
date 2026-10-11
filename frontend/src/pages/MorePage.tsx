import { Link } from 'react-router-dom'
import { ChevronRight, History, UserRound, Ticket, Store, Users } from '../lib/icons'

const entries = [
  { to: '/history', title: 'История операций', detail: 'Покупки и начисления', Icon: History },
  { to: '/me', title: 'Профиль и восстановление', detail: 'Номер карты и резервный код', Icon: UserRound },
  { to: '/promos', title: 'Акции', detail: 'Предложения 6.7 Coffee', Icon: Ticket },
  { to: '/invite', title: 'Пригласить друга', detail: 'Поделиться своей ссылкой', Icon: Users },
]
export default function MorePage() {
  return <div className="pb-6">
    <header className="bg-white px-4 pt-10 pb-5 border-b border-line"><h1 className="text-2xl font-bold text-ink">Ещё</h1><p className="text-ink-secondary text-sm mt-1">Настройки карты и другие разделы</p></header>
    <div className="p-4 space-y-2">{entries.map(({to,title,detail,Icon}) => <Link key={to} to={to} className="card !mb-0 flex items-center gap-3 no-underline">
      <span className="w-11 h-11 rounded-xl bg-brand-soft text-brand flex items-center justify-center"><Icon size={21}/></span><span className="flex-1"><b className="block text-ink text-sm">{title}</b><small className="block text-ink-secondary mt-1">{detail}</small></span><ChevronRight className="text-ink-tertiary" size={18}/>
    </Link>)}</div>
  </div>
}

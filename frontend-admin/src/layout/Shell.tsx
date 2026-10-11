import { useState } from 'react'
import type { ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Activity, Coffee, Gift, History, LayoutDashboard, LogOut, MoreHorizontal, Search, Settings, Store, Users, X } from 'lucide-react'
import { useApi } from '../api/useApi'
import type { Health } from '../api/types'
import { ago } from '../lib/format'
import { Drawer, StatusDot, cx } from '../ui/kit'

type NavItem = { to: string; label: string; icon: ReactNode; end?: boolean }
const MAIN: NavItem[] = [
  { to: '/', label: 'Сегодня', icon: <LayoutDashboard size={20} />, end: true },
  { to: '/operations', label: 'Операции', icon: <Activity size={20} /> },
  { to: '/customers', label: 'Клиенты', icon: <Users size={20} /> },
  { to: '/menu', label: 'Меню', icon: <Coffee size={20} /> },
]
const MORE: NavItem[] = [
  { to: '/cash', label: 'Касса', icon: <Store size={20} /> },
  { to: '/marketing', label: 'Маркетинг', icon: <Gift size={20} /> },
  { to: '/system', label: 'Система', icon: <Settings size={20} /> },
  { to: '/legacy', label: 'Старая версия', icon: <History size={20} /> },
]

function TillStatus() {
  const { data } = useApi<Health & { now: number }>('/evotor/health', { refreshMs: 60_000 })
  const nav = useNavigate()
  if (!data) return <span className="text-xs text-ink-tertiary">касса…</span>
  const enabled = data.stores.filter((s) => s.enabled)
  const last = enabled.reduce<number | null>((m, s) => (s.lastFastAt && (!m || s.lastFastAt > m) ? s.lastFastAt : m), null)
  const text = !enabled.length ? 'точки не выбраны' : `последний опрос ${ago(last, data.now)}`
  return (
    <button type="button" onClick={() => nav('/')} className="flex min-h-[36px] items-center gap-2 rounded-full px-2 text-xs text-ink-secondary hover:bg-gray-100" title="Статус кассы">
      <StatusDot level={data.level} label={`Статус кассы: ${data.level}`} />
      <span className="hidden sm:inline">Касса: {text}</span>
      <span className="sm:hidden">{enabled.length ? ago(last, data.now) : 'нет точек'}</span>
    </button>
  )
}

function GlobalSearch() {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const nav = useNavigate()
  const go = (path: string) => {
    nav(`${path}${path.includes('?') ? '&' : '?'}q=${encodeURIComponent(q.trim())}`)
    setOpen(false)
    setQ('')
  }
  const has = q.trim().length > 0
  return (
    <div className="relative min-w-0 flex-1 sm:max-w-md">
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary" aria-hidden />
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === 'Enter' && has) go(/^\d+$/.test(q.trim()) ? '/customers' : '/menu') }}
        placeholder="Номер карты, ник, товар…"
        aria-label="Поиск"
        className="min-h-[40px] w-full rounded-full border border-line bg-gray-50 pl-9 pr-3 text-sm focus:border-brand-mid focus:bg-white focus:outline-none"
      />
      {open && has && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-xl border border-line bg-white shadow-soft">
          {[
            ['Клиенты', '/customers'],
            ['Товары', '/menu'],
            ['Операции (чек/карта)', '/operations'],
          ].map(([label, path]) => (
            <button key={path} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => go(path)} className="flex min-h-[44px] w-full items-center justify-between px-3 text-left text-sm hover:bg-brand-light">
              <span>{label}</span>
              <span className="max-w-[50%] truncate text-ink-secondary">«{q.trim()}»</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Shell({ onLogout }: { onLogout: () => void }) {
  const [more, setMore] = useState(false)
  const loc = useLocation()
  const moreActive = MORE.some((m) => loc.pathname.startsWith(m.to))
  const link = ({ isActive }: { isActive: boolean }) =>
    cx('flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-[15px] font-medium', isActive ? 'bg-brand-soft text-brand' : 'text-ink-secondary hover:bg-gray-100')
  return (
    <div className="min-h-screen bg-page md:flex">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-white p-3 md:flex">
        <div className="mb-4 px-3 pt-2 text-lg font-extrabold text-brand">6.7 Coffee <span className="block text-xs font-medium text-ink-secondary">Админка</span></div>
        <nav className="flex flex-1 flex-col gap-1" aria-label="Разделы">
          {[...MAIN, ...MORE].map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={link}>{n.icon}{n.label}</NavLink>
          ))}
        </nav>
        <button type="button" onClick={onLogout} className="flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-[15px] text-ink-secondary hover:bg-gray-100">
          <LogOut size={20} /> Выйти
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-white/95 px-4 py-2 backdrop-blur">
          <span className="text-base font-extrabold text-brand md:hidden">6.7</span>
          <GlobalSearch />
          <TillStatus />
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-4 md:pb-8">
          <Outlet />
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Разделы">
        {MAIN.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx('flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold', isActive ? 'text-brand' : 'text-ink-secondary')}>
            {n.icon}{n.label}
          </NavLink>
        ))}
        <button type="button" onClick={() => setMore(true)} className={cx('flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold', moreActive ? 'text-brand' : 'text-ink-secondary')}>
          <MoreHorizontal size={20} />Ещё
        </button>
      </nav>

      <Drawer open={more} onClose={() => setMore(false)} title="Ещё">
        <div className="flex flex-col gap-1">
          {MORE.map((n) => (
            <NavLink key={n.to} to={n.to} onClick={() => setMore(false)} className={link}>{n.icon}{n.label}</NavLink>
          ))}
          <button type="button" onClick={() => { setMore(false); onLogout() }} className="flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-[15px] text-ink-secondary hover:bg-gray-100">
            <X size={20} /> Выйти
          </button>
        </div>
      </Drawer>
    </div>
  )
}

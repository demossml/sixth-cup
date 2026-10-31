import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity, BarChart3, Bot, Box, LineChart, CalendarClock, Coffee, Gift, HelpCircle, 
  LayoutDashboard, LogOut, ClipboardList, Package, Search, Settings, Menu,
  Share2, Store, Users, X, MoreHorizontal, Milk, Ruler, Layers,
} from 'lucide-react'
import { useApi } from '../api/useApi'
import type { Health } from '../api/types'
import { ago } from '../lib/format'

type NavItem = { to: string; label: string; icon: ReactNode; end?: boolean; badge?: 'ai' }

const SHIFT: NavItem[] = [
  { to: '/', label: 'Сегодня', icon: <LayoutDashboard size={17} />, end: true },
  { to: '/operations', label: 'Операции', icon: <Activity size={17} /> },
  { to: '/customers', label: 'Клиенты', icon: <Users size={17} /> },
  { to: '/menu', label: 'Меню', icon: <Coffee size={17} /> },
]

/** Три независимые системы конфигурации товара — отдельные разделы, не вкладки «Меню». */
const CONFIG: NavItem[] = [
  { to: '/volume-schemes', label: 'Схемы объёмов', icon: <Ruler size={17} /> },
  { to: '/milk-schemes', label: 'Схемы молока', icon: <Milk size={17} /> },
  { to: '/addon-schemes', label: 'Схемы добавок', icon: <Layers size={17} /> },
]

const MANAGE: NavItem[] = [
  { to: '/cash', label: 'Касса', icon: <Store size={17} /> },
  { to: '/stock', label: 'Склад', icon: <Box size={17} /> },
  { to: '/purchases', label: 'Закупки', icon: <Package size={17} /> },
  { to: '/inventory', label: 'Инвентаризация', icon: <ClipboardList size={17} /> },
  { to: '/staff', label: 'Сотрудники', icon: <Users size={17} /> },
  { to: '/marketing', label: 'Контент', icon: <Gift size={17} /> },
  { to: '/referrals', label: 'Рефералка', icon: <Share2 size={17} /> },
]

const ANALYTICS: NavItem[] = [
  { to: '/analytics', label: 'Аналитика', icon: <LineChart size={17} /> },
  { to: '/compare', label: 'Сравнение', icon: <BarChart3 size={17} /> },
  { to: '/events', label: 'События', icon: <CalendarClock size={17} /> },
  { to: '/assistant', label: 'Помощник', icon: <Bot size={17} />, badge: 'ai' },
]

const SYSTEM: NavItem[] = [
  { to: '/help', label: 'Справка', icon: <HelpCircle size={17} /> },
  { to: '/system', label: 'Система', icon: <Settings size={17} /> },
]

/**
 * Нижняя навигация телефона: три раздела, которые нужны с кассы каждый день.
 * «Заказы» — это вкладка существующих «Закупок» (?tab=orders), а не отдельный маршрут.
 */
const MOBILE_PRIMARY: NavItem[] = [
  { to: '/', label: 'Сегодня', icon: <LayoutDashboard size={20} />, end: true },
  { to: '/cash', label: 'Касса', icon: <Store size={20} /> },
  { to: '/purchases?tab=orders', label: 'Заказы', icon: <ClipboardList size={20} /> },
]

const MOBILE_PRIMARY_PATHS = ['/', '/cash', '/purchases']

const MOBILE_GROUPS: { title: string; items: NavItem[] }[] = [
  { title: 'Смена', items: SHIFT.filter((i) => !MOBILE_PRIMARY_PATHS.includes(i.to)) },
  { title: 'Конфигурация', items: CONFIG },
  { title: 'Управление', items: MANAGE.filter((i) => !MOBILE_PRIMARY_PATHS.includes(i.to)) },
  { title: 'Аналитика', items: ANALYTICS },
  { title: 'Система', items: SYSTEM },
]

const TITLES: Record<string, string> = {
  '/': 'Сегодня',
  '/operations': 'Операции',
  '/customers': 'Клиенты',
  '/menu': 'Меню',
  '/volume-schemes': 'Схемы объёмов',
  '/milk-schemes': 'Схемы молока',
  '/addon-schemes': 'Схемы добавок',
  '/cash': 'Касса',
  '/stock': 'Склад',
  '/purchases': 'Закупки',
  '/inventory': 'Инвентаризация',
  '/staff': 'Сотрудники',
  '/marketing': 'Контент',
  '/referrals': 'Рефералка',
  '/analytics': 'Аналитика',
  '/compare': 'Сравнение',
  '/events': 'События',
  '/assistant': 'Помощник',
  '/help': 'Справка',
  '/system': 'Система',
}

function NavGroup({ title, items, onNavigate }: { title: string; items: NavItem[]; onNavigate?: () => void }) {
  return (
    <>
      <div className="nav-cap">{title}</div>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => `nav-item${isActive ? ' is-active' : ''}`}
          onClick={onNavigate}
        >
          {item.icon}
          <span className="label">{item.label}</span>
          {item.badge === 'ai' && <span className="ai">ai</span>}
        </NavLink>
      ))}
    </>
  )
}

function TillFoot() {
  const { data } = useApi<Health & { now: number }>('/evotor/health', { refreshMs: 60_000 })
  const nav = useNavigate()
  const enabled = data?.stores.filter((s) => s.enabled) ?? []
  const last = enabled.reduce<number | null>((m, s) => (s.lastFastAt && (!m || s.lastFastAt > m) ? s.lastFastAt : m), null)
  const label = !data ? '…' : !enabled.length ? 'точки выкл.' : `опрос ${ago(last, data.now)}`
  return (
    <button type="button" className="side-status" onClick={() => nav('/cash')} title="Касса">
      <i />
      <span>{label}</span>
      <b>6.7</b>
    </button>
  )
}

export default function Shell({ onLogout }: { onLogout?: () => void }) {
  const loc = useLocation()
  const nav = useNavigate()
  const [sideOpen, setSideOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  const [q, setQ] = useState('')

  const title = useMemo(() => {
    const path = loc.pathname.replace(/\/$/, '') || '/'
    if (TITLES[path]) return TITLES[path]
    const key = Object.keys(TITLES).find((k) => k !== '/' && path.startsWith(k))
    return key ? TITLES[key] : 'Админка'
  }, [loc.pathname])

  const closeSide = () => setSideOpen(false)
  const closeMore = () => setMoreOpen(false)
  useEffect(() => { setSideOpen(false); setMoreOpen(false) }, [loc.pathname])
  useEffect(() => {
    if (!sideOpen && !moreOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [sideOpen, moreOpen])

  const logout = () => {
    if (onLogout) onLogout()
    else {
      sessionStorage.removeItem('adminToken')
      localStorage.removeItem('adminToken')
      window.location.reload()
    }
  }

  useEffect(() => {
    if (!moreOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMoreOpen(false) }
    document.addEventListener('keydown', onKey)
    moreRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [moreOpen])

  // «Ещё» is highlighted whenever the current section is not one of the three primary tabs.
  const path = loc.pathname.replace(/\/$/, '') || '/'
  const inPrimary = MOBILE_PRIMARY_PATHS.some((p) => (p === '/' ? path === '/' : path.startsWith(p)))

  const goSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const s = q.trim()
    if (!s) return
    nav(`/operations?q=${encodeURIComponent(s)}`)
    setQ('')
  }

  return (
    <div className="app">
      {sideOpen && <div className="side-backdrop" onClick={closeSide} aria-hidden />}
      <aside className={`side${sideOpen ? ' is-open' : ''}`}>
        <div className="brand">
          <img src="/67coffee-mark.png" alt="67 Coffee" />
          <div className="brand-text">
            <div className="brand-name">6<span className="brand-dot" aria-hidden />7 Coffee</div>
            <div className="brand-sub">админка</div>
          </div>
        </div>

        <nav className="nav" aria-label="Разделы">
          <NavGroup title="Смена" items={SHIFT} onNavigate={closeSide} />
          <NavGroup title="Конфигурация" items={CONFIG} onNavigate={closeSide} />
          <NavGroup title="Управление" items={MANAGE} onNavigate={closeSide} />
          <NavGroup title="Аналитика" items={ANALYTICS} onNavigate={closeSide} />
        </nav>

        <div className="side-foot">
          <TillFoot />
          <NavGroup title="" items={SYSTEM} onNavigate={closeSide} />
          <div className="side-sep" />
          <button type="button" className="user" onClick={logout}>
            <span className="avatar">67</span>
            <span className="user-text">
              <span className="user-name" style={{ display: 'block' }}>Админ</span>
              <span className="user-role" style={{ display: 'block' }}>Администратор</span>
            </span>
            <span className="out" aria-hidden>
              <LogOut size={15} />
            </span>
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="mobile-bar btn btn-ghost"
            style={{ marginRight: 4 }}
            onClick={() => setSideOpen(true)}
            aria-label="Меню"
          >
            <Menu size={16} />
          </button>
          <div className="crumbs">
            <span>6.7</span>
            <span className="sep">/</span>
            <b>{title}</b>
          </div>
          <form className="top-search" onSubmit={goSearch} style={{ marginLeft: 'auto' }}>
            <Search size={14} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск: чек, карта, клиент…"
              aria-label="Поиск"
            />
          </form>
        </header>
        <div className="main-scroll">
          <div className="view-body">
            <Outlet />
          </div>
        </div>
      </div>

      {/* Phones: fixed bottom bar + «Ещё» sheet; both reuse the desktop nav definitions above. */}
      <nav className="mobile-nav" aria-label="Быстрый доступ">
        {MOBILE_PRIMARY.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => (isActive ? 'is-active' : '')}
          >
            {item.icon}
            <span>{item.label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          className={inPrimary ? undefined : 'is-active'}
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
          onClick={() => setMoreOpen(true)}
        >
          <MoreHorizontal size={20} />
          <span>И ещё</span>
        </button>
      </nav>

      {moreOpen && <div className="sheet-backdrop" onClick={closeMore} aria-hidden />}
      <div
        ref={moreRef}
        tabIndex={-1}
        className={`sheet${moreOpen ? ' is-on' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Все разделы"
        hidden={!moreOpen}
      >
        <div className="sheet-grab" aria-hidden />
        <div className="sheet-head">
          <h3>Все разделы</h3>
          <button type="button" className="icon-btn" onClick={closeMore} aria-label="Закрыть">
            <X size={18} />
          </button>
        </div>
        <nav className="nav" aria-label="Все разделы">
          {MOBILE_GROUPS.map((g) => (
            <NavGroup key={g.title} title={g.title} items={g.items} onNavigate={closeMore} />
          ))}
        </nav>
        <div className="sheet-foot">
          <button type="button" className="nav-item" onClick={logout}>
            <LogOut size={20} />
            <span className="label">Выйти</span>
          </button>
        </div>
      </div>
    </div>
  )
}

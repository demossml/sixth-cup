import { NavLink, Outlet } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { adminFetch } from '../api/client'
import { Badge } from './Badge'

const nav = [
  { to: '/', label: 'Сегодня', end: true },
  { to: '/operations', label: 'Операции' },
  { to: '/customers', label: 'Клиенты' },
  { to: '/menu/products', label: 'Меню' },
  { to: '/evotor', label: 'Касса' },
  { to: '/marketing', label: 'Маркетинг' },
  { to: '/system', label: 'Система' },
  { to: '/legacy', label: 'Legacy' },
]

export function Layout() {
  const [health, setHealth] = useState<{ level: string; label: string }>({ level: 'neutral', label: '—' })

  useEffect(() => {
    let cancelled = false
    const load = () => {
      adminFetch<{ stores: { level: string; syncEnabled: boolean; name: string }[] }>('/evotor/health')
        .then((r) => {
          if (cancelled) return
          const active = r.stores.filter((s) => s.syncEnabled)
          if (!active.length) {
            setHealth({ level: 'warn', label: 'нет sync' })
            return
          }
          if (active.some((s) => s.level === 'bad')) setHealth({ level: 'bad', label: 'касса' })
          else if (active.some((s) => s.level === 'warn')) setHealth({ level: 'warn', label: 'касса' })
          else setHealth({ level: 'ok', label: 'касса' })
        })
        .catch(() => {
          if (!cancelled) setHealth({ level: 'bad', label: 'нет связи' })
        })
    }
    load()
    const t = setInterval(load, 60_000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [])

  return (
    <div className="min-h-screen bg-slate-50 text-ink flex flex-col md:flex-row">
      <aside className="md:w-52 shrink-0 border-b md:border-b-0 md:border-r border-line bg-white">
        <div className="px-4 py-3 font-bold text-brand">6.7 Admin</div>
        <nav className="flex md:flex-col gap-1 px-2 pb-3 overflow-x-auto">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm whitespace-nowrap ${isActive ? 'bg-brand text-white' : 'hover:bg-slate-100'}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex-1 min-w-0">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-white/95 px-4 py-2 backdrop-blur">
          <span className="text-sm text-ink-secondary">Админка 6.7 Coffee</span>
          <Badge level={health.level as any}>{health.label}</Badge>
        </header>
        <main className="p-4 max-w-6xl mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

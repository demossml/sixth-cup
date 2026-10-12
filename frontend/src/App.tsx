import { useEffect, useState } from 'react'
import { NavLink, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { getJwt } from './api'
import CardPage from './pages/CardPage'
import MenuPage from './pages/MenuPage'
import OnboardingPage from './pages/OnboardingPage'
import ProfilePage from './pages/ProfilePage'
import PromosPage from './pages/PromosPage'
import InvitePage from './pages/InvitePage'
import MorePage from './pages/MorePage'
import HistoryPage from './pages/HistoryPage'
import StoresPage from './pages/StoresPage'
import CardQrPage from './pages/CardQrPage'
import { ensureGuest } from './lib/ensureGuest'
import { useApp } from './lib/app'
import InstallBanner from './components/InstallBanner'
import { Home, LayoutGrid, MoreHorizontal } from './lib/icons'

function RequireSession() {
  const { sync } = useApp()
  const [ready, setReady] = useState(!!getJwt())
  const [fail, setFail] = useState(false)

  // Новая карта: сразу синхронизируемся, чтобы QR появился без тапа «Получить карту».
  const onGuestReady = () => {
    setReady(true)
    // Если параллельно шёл «безавторизационный» sync, он вернёт 'noauth' — повторяем уже с токеном.
    void sync().then((r) => { if (r === 'noauth') void sync() })
  }

  useEffect(() => {
    if (getJwt()) {
      setReady(true)
      return
    }
    void ensureGuest().then((s) => {
      if (s === 'ok') onGuestReady()
      else setFail(true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (fail) {
    return (
      <div className="max-w-[480px] mx-auto min-h-screen bg-page p-6 flex flex-col justify-center">
        <img src="/logo-mark.png" alt="" className="w-16 h-16 rounded-2xl mb-4" />
        <h1 className="text-[22px] leading-7 font-semibold text-ink mb-2">Нужен интернет один раз</h1>
        <p className="text-ink-secondary text-sm mb-4">
          Чтобы выдать карту лояльности, подключитесь к сети. Телефон и SMS не требуются.
        </p>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setFail(false)
            void ensureGuest().then((s) => {
              if (s === 'ok') onGuestReady()
              else setFail(true)
            })
          }}
        >
          Повторить
        </button>
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="max-w-[480px] mx-auto min-h-screen bg-page flex items-center justify-center" role="status" aria-label="Открываем карту">
        <img src="/logo-mark.png" alt="" className="w-14 h-14 rounded-2xl" />
      </div>
    )
  }

  if (!localStorage.getItem('sc-onboarded')) {
    return <Navigate to="/onboarding" replace />
  }

  return <Outlet />
}

const NAV = [
  { to: '/', end: true, label: 'Карта', Icon: Home },
  { to: '/menu', end: false, label: 'Меню', Icon: LayoutGrid },
  { to: '/more', end: false, label: 'Ещё', Icon: MoreHorizontal },
]

function Layout() {
  return (
    <div className="max-w-[480px] mx-auto min-h-screen bg-page" style={{ paddingBottom: 'calc(4rem + env(safe-area-inset-bottom, 0px))' }}>
      <Outlet />
      <InstallBanner variant="fixed" />
      <nav
        aria-label="Основное меню"
        className="fixed bottom-0 left-0 right-0 max-w-[480px] mx-auto bg-page border-t border-line flex z-40"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {NAV.map(({ to, end, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex-1 min-h-14 flex flex-col items-center justify-center gap-0.5 text-[12px] leading-4 font-semibold no-underline ${isActive ? 'text-brand' : 'text-ink-secondary'}`
            }
          >
            {({ isActive }) => (<>
              <Icon size={24} strokeWidth={1.75} />
              {label}
            </>)}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route element={<RequireSession />}>
        <Route element={<Layout />}>
          <Route path="/" element={<CardPage />} />
          <Route path="/menu" element={<MenuPage />} />
          <Route path="/promos" element={<PromosPage />} />
          <Route path="/me" element={<ProfilePage />} />
          <Route path="/invite" element={<InvitePage />} />
          <Route path="/more" element={<MorePage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/stores" element={<StoresPage />} />
          <Route path="/card-qr" element={<CardQrPage />} />
        </Route>
      </Route>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

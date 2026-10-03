import { useEffect, useState } from 'react'
import { NavLink, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { getJwt } from './api'
import CardPage from './pages/CardPage'
import MenuPage from './pages/MenuPage'
import OnboardingPage from './pages/OnboardingPage'
import ProfilePage from './pages/ProfilePage'
import PromosPage from './pages/PromosPage'
import InvitePage from './pages/InvitePage'
import { ensureGuest } from './lib/ensureGuest'
import InstallBanner from './components/InstallBanner'
import { Home, LayoutGrid, Megaphone, User } from './lib/icons'

function RequireSession() {
  const [ready, setReady] = useState(!!getJwt())
  const [fail, setFail] = useState(false)

  useEffect(() => {
    if (getJwt()) {
      setReady(true)
      return
    }
    void ensureGuest().then((s) => {
      if (s === 'ok') setReady(true)
      else setFail(true)
    })
  }, [])

  if (fail) {
    return (
      <div className="max-w-[480px] mx-auto min-h-screen bg-page p-6 flex flex-col justify-center">
        <img src="/logo-mark.png" alt="" className="w-16 h-16 rounded-2xl mb-4" />
        <h1 className="text-xl font-bold text-ink mb-2">Нужен интернет один раз</h1>
        <p className="text-ink-secondary text-sm mb-4">
          Чтобы выдать карту лояльности, подключитесь к сети. Телефон и SMS не требуются.
        </p>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setFail(false)
            void ensureGuest().then((s) => {
              if (s === 'ok') setReady(true)
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
      <div className="max-w-[480px] mx-auto min-h-screen bg-page flex items-center justify-center text-ink-secondary text-sm">
        Открываем карту…
      </div>
    )
  }

  if (!localStorage.getItem('sc-onboarded')) {
    return <Navigate to="/onboarding" replace />
  }

  return <Outlet />
}

function Layout() {
  return (
    <div className="max-w-[480px] mx-auto min-h-screen bg-page pb-20">
      <Outlet />
      <InstallBanner />
      <nav className="fixed bottom-0 left-0 right-0 max-w-[480px] mx-auto bg-white border-t border-line flex z-40">
        <NavLink to="/" end className={({ isActive }) => `flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[11px] no-underline ${isActive ? 'text-brand font-semibold' : 'text-ink-tertiary'}`}>
          {({ isActive }) => (<>
            <Home size={22} strokeWidth={isActive ? 2.25 : 1.75} />
            Карта
          </>)}
        </NavLink>
        <NavLink to="/menu" className={({ isActive }) => `flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[11px] no-underline ${isActive ? 'text-brand font-semibold' : 'text-ink-tertiary'}`}>
          {({ isActive }) => (<>
            <LayoutGrid size={22} strokeWidth={isActive ? 2.25 : 1.75} />
            Меню
          </>)}
        </NavLink>
        <NavLink to="/promos" className={({ isActive }) => `flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[11px] no-underline ${isActive ? 'text-brand font-semibold' : 'text-ink-tertiary'}`}>
          {({ isActive }) => (<>
            <Megaphone size={22} strokeWidth={isActive ? 2.25 : 1.75} />
            Акции
          </>)}
        </NavLink>
        <NavLink to="/me" className={({ isActive }) => `flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[11px] no-underline ${isActive ? 'text-brand font-semibold' : 'text-ink-tertiary'}`}>
          {({ isActive }) => (<>
            <User size={22} strokeWidth={isActive ? 2.25 : 1.75} />
            Профиль
          </>)}
        </NavLink>
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
        </Route>
      </Route>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

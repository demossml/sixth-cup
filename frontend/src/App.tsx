import { NavLink, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { getJwt } from './api'
import CardPage from './pages/CardPage'
import CashierPage from './pages/CashierPage'
import DevPage from './pages/DevPage'
import LoginPage from './pages/LoginPage'
import MenuPage from './pages/MenuPage'
import ProfilePage from './pages/ProfilePage'
import PromosPage from './pages/PromosPage'
import { Home, LayoutGrid, Megaphone, User } from './lib/icons'

function Layout() {
  if (!getJwt()) return <Navigate to="/login" replace />
  return (
    <div className="max-w-[480px] mx-auto min-h-screen bg-page pb-20">
      <Outlet />
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] flex bg-white border-t border-line pb-[env(safe-area-inset-bottom)] z-20">
        <NavLink to="/" end className={({ isActive }) => `flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[11px] no-underline ${isActive ? 'text-brand font-semibold' : 'text-ink-tertiary'}`}>
          {({ isActive }) => (<>
            <Home size={22} strokeWidth={isActive ? 2.25 : 1.75} />
            Главная
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
      <Route path="/login" element={<div className="max-w-[480px] mx-auto min-h-screen bg-page"><LoginPage /></div>} />
      <Route path="/cashier" element={<div className="max-w-[480px] mx-auto min-h-screen bg-page"><CashierPage /></div>} />
      <Route path="/dev" element={<div className="max-w-[480px] mx-auto min-h-screen bg-page"><DevPage /></div>} />
      <Route element={<Layout />}>
        <Route path="/" element={<CardPage />} />
        <Route path="/menu" element={<MenuPage />} />
        <Route path="/promos" element={<PromosPage />} />
        <Route path="/me" element={<ProfilePage />} />
      </Route>
    </Routes>
  )
}

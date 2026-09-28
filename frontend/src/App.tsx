import { NavLink, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { getJwt } from './api'
import CardPage from './pages/CardPage'
import CashierPage from './pages/CashierPage'
import DevPage from './pages/DevPage'
import LoginPage from './pages/LoginPage'
import ProfilePage from './pages/ProfilePage'
import PromosPage from './pages/PromosPage'

function Layout() {
  if (!getJwt()) return <Navigate to="/login" replace />
  return (
    <div className="max-w-[480px] mx-auto min-h-screen bg-white pb-20">
      <Outlet />
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] flex bg-white border-t border-line pb-[env(safe-area-inset-bottom)]">
        <NavLink to="/" end className={({ isActive }) => `flex-1 text-center py-3 text-sm no-underline ${isActive ? 'text-brand font-bold' : 'text-muted'}`}>Карта</NavLink>
        <NavLink to="/promos" className={({ isActive }) => `flex-1 text-center py-3 text-sm no-underline ${isActive ? 'text-brand font-bold' : 'text-muted'}`}>Акции</NavLink>
        <NavLink to="/me" className={({ isActive }) => `flex-1 text-center py-3 text-sm no-underline ${isActive ? 'text-brand font-bold' : 'text-muted'}`}>Профиль</NavLink>
      </nav>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<div className="max-w-[480px] mx-auto min-h-screen bg-white"><LoginPage /></div>} />
      <Route path="/cashier" element={<div className="max-w-[480px] mx-auto min-h-screen bg-white"><CashierPage /></div>} />
      <Route path="/dev" element={<div className="max-w-[480px] mx-auto min-h-screen bg-white"><DevPage /></div>} />
      <Route element={<Layout />}>
        <Route path="/" element={<CardPage />} />
        <Route path="/promos" element={<PromosPage />} />
        <Route path="/me" element={<ProfilePage />} />
      </Route>
    </Routes>
  )
}

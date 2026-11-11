import { lazy, Suspense, useEffect, useState } from 'react'
import { NavLink, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { getJwt } from './api'
import CardPage from './pages/CardPage'
import MenuPage from './pages/MenuPage'
import ProductPage from './pages/ProductPage'
import CartPage from './pages/CartPage'
import StorePickerPage from './pages/StorePickerPage'
import SearchPage from './pages/SearchPage'
import OnboardingPage from './pages/OnboardingPage'
import ProfilePage from './pages/ProfilePage'
import PromosPage from './pages/PromosPage'
import InvitePage from './pages/InvitePage'
import MorePage from './pages/MorePage'
import LegalPage from './pages/LegalPage'
import AboutPage from './pages/AboutPage'
import HistoryPage from './pages/HistoryPage'
import StoresPage from './pages/StoresPage'
import CardQrPage from './pages/CardQrPage'

const GamePage = lazy(() => import('./pages/GamePage'))

import { ensureGuest } from './lib/ensureGuest'
import { useApp } from './lib/app'
import InstallBanner from './components/InstallBanner'
import { CreditCard, BookOpen, MoreHorizontal } from './lib/icons'

function RequireSession() {
  const { sync } = useApp()
  const [ready, setReady] = useState(!!getJwt())
  const [fail, setFail] = useState<null | 'offline' | 'rate_limited'>(null)
  // Онбординг показываем ДО создания карты: гость успевает ввести код приглашения,
  // а «брошенные» аккаунты не появляются у тех, кто закрыл приложение на первом экране.
  const onboarded = (() => { try { return !!localStorage.getItem('sc-onboarded') } catch { return true } })()

  // Новая карта: сразу синхронизируемся, чтобы QR появился без тапа «Получить карту».
  const onGuestReady = () => {
    setReady(true)
    // Если параллельно шёл «безавторизационный» sync, он вернёт 'noauth' — повторяем уже с токеном.
    void sync().then((r) => { if (r === 'noauth') void sync() })
  }

  useEffect(() => {
    if (!onboarded) return
    if (getJwt()) {
      setReady(true)
      return
    }
    void ensureGuest().then((s) => {
      // Карта создана и при неизвестном коде — гость просто остаётся без реферера (плашка на титуле).
      if (s === 'ok' || s === 'invalid_invite') onGuestReady()
      else setFail(s === 'rate_limited' ? 'rate_limited' : 'offline')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Сначала онбординг: карта создаётся уже после него, чтобы код друга можно было ввести.
  if (!onboarded) return <Navigate to="/onboarding" replace />

  if (fail) {
    const limited = fail === 'rate_limited'
    return (
      <div className="max-w-[480px] mx-auto min-h-screen bg-page p-6 flex flex-col justify-center items-center text-center">
        <div className="w-28 h-28 rounded-3xl bg-white ring-1 ring-black/5 flex items-center justify-center mb-4">
          <img src="/logo-mark.png" alt="" className="w-24 h-24 object-contain" />
        </div>
        <h1 className="text-[22px] leading-7 font-semibold text-ink mb-2">
          {limited ? 'Слишком много попыток' : 'Нужен интернет один раз'}
        </h1>
        <p className="text-ink-secondary text-sm mb-4">
          {limited
            ? 'С этого адреса за последний час создано слишком много карт. Подождите несколько минут и нажмите «Повторить» — прогресс и приглашение не потеряются.'
            : 'Чтобы выдать карту лояльности, подключитесь к сети. Телефон и SMS не требуются.'}
        </p>
        <button
          type="button"
          className="btn max-w-[320px]"
          onClick={() => {
            setFail(null)
            void ensureGuest().then((s) => {
              if (s === 'ok' || s === 'invalid_invite') onGuestReady()
              else setFail(s === 'rate_limited' ? 'rate_limited' : 'offline')
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
      <div className="max-w-[480px] mx-auto min-h-screen bg-page flex flex-col items-center justify-center gap-3" role="status" aria-label="Открываем карту">
        <img src="/logo-mark.png" alt="" className="w-14 h-14 rounded-2xl" />
        <p className="text-[15px] font-semibold text-ink">Обновляем данные…</p>
        <p className="text-[13px] text-ink-secondary">Это займёт несколько секунд</p>
      </div>
    )
  }

  return <Outlet />
}

const NAV = [
  { to: '/', end: true, label: 'Карта', Icon: CreditCard },
  { to: '/menu', end: false, label: 'Меню', Icon: BookOpen },
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
              `relative flex-1 min-h-14 flex flex-col items-center justify-center gap-0.5 text-[12px] leading-4 no-underline ${
                // Аудит F-14: активная вкладка отличалась только цветом — добавляем полоску и вес.
                isActive ? 'text-brand font-bold' : 'text-ink-secondary font-semibold'
              }`
            }
          >
            {({ isActive }) => (<>
              {isActive ? <span className="absolute top-0 h-[2px] w-8 rounded-full bg-brand" aria-hidden="true" /> : null}
              <Icon size={24} strokeWidth={isActive ? 2.1 : 1.75} />
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
      {/* Аудит F-15: у гостя с картой онбординг бессмысленен — сразу на главную. */}
      <Route path="/onboarding" element={getJwt() ? <Navigate to="/" replace /> : <OnboardingPage />} />
      <Route element={<RequireSession />}>
        <Route element={<Layout />}>
          <Route path="/" element={<CardPage />} />
          <Route path="/menu" element={<MenuPage />} />
          <Route path="/catalog" element={<MenuPage catalog />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/menu/:productId" element={<ProductPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/pick-store" element={<StorePickerPage />} />
          <Route path="/promos" element={<PromosPage />} />
          <Route path="/me" element={<ProfilePage />} />
          <Route path="/invite" element={<InvitePage />} />
          <Route path="/more" element={<MorePage />} />
          <Route path="/legal" element={<LegalPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/stores" element={<StoresPage />} />
          <Route
            path="/game"
            element={
              <Suspense fallback={<div className="p-6 text-center text-ink-secondary">Загрузка…</div>}>
                <GamePage />
              </Suspense>
            }
          />
          <Route path="/card-qr" element={<CardQrPage />} />
        </Route>
      </Route>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

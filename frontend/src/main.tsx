import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { AppProvider } from './lib/app'
import { bootstrapCustomer } from './lib/auth'
import './styles.css'

if (!import.meta.env.DEV) registerSW({ immediate: true })

async function start() {
  const path = location.pathname
  const invite = new URLSearchParams(location.search).get('invite') ?? undefined
  const hasLocalAccount = !!localStorage.getItem('sc-jwt')

  // Recovery and legacy SMS login must be reachable before automatic guest bootstrap.
  if (path === '/recover' || path === '/login' || path === '/onboarding') {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <BrowserRouter>
          <AppProvider><App /></AppProvider>
        </BrowserRouter>
      </React.StrictMode>,
    )
    return
  }

  try {
    await bootstrapCustomer(invite)
    const launches = Number(localStorage.getItem('sc-launch-count') ?? 0) + 1
    localStorage.setItem('sc-launch-count', String(launches))
    if (invite) history.replaceState({}, '', location.pathname + location.hash)
  } catch (e) {
    // If there is no account and the first bootstrap needs the network,
    // keep a small retry screen instead of silently creating a second account.
    if (!hasLocalAccount) {
      ReactDOM.createRoot(document.getElementById('root')!).render(
        <div className="min-h-screen max-w-[480px] mx-auto bg-page p-6 flex items-center justify-center">
          <div className="card text-center">
            <h1 className="text-xl font-bold">Не удалось открыть карту</h1>
            <p className="text-ink-secondary text-sm mt-2">Подключитесь к интернету один раз и попробуйте снова.</p>
            <button className="btn mt-4" onClick={() => location.reload()}>Повторить</button>
            <p className="text-xs text-ink-tertiary mt-3">{(e as Error).message}</p>
          </div>
        </div>,
      )
      return
    }
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserRouter>
        <AppProvider>
          <App />
        </AppProvider>
      </BrowserRouter>
    </React.StrictMode>,
  )
}

void start()

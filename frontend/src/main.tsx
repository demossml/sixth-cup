import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { AppProvider } from './lib/app'
import './styles.css'
import './lib/installStore'
import { installClientLog } from './lib/clientLog'
import { getJwt } from './api'
import { captureInvite, setInviteNotice } from './lib/invite'
import { track } from './lib/analytics'

installClientLog()
track('pwa_open')

if (!import.meta.env.DEV) registerSW({ immediate: true })

// Referral link: remembered only for a browser that has no account yet, then removed from the address bar.
// Если карта уже есть — код не применяем, но и не теряем: покажем честную плашку на титуле.
const captured = captureInvite(location.search, !!getJwt())
if (captured.ignored) setInviteNotice({ kind: 'ignored', code: captured.ignored })
if (captured.strip) {
  const u = new URL(location.href)
  u.searchParams.delete('invite')
  history.replaceState(null, '', u.pathname + u.search + u.hash)
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

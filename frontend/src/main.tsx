import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { AppProvider } from './lib/app'
import './styles.css'
import { installClientLog } from './lib/clientLog'
import { getJwt } from './api'
import { captureInvite } from './lib/invite'

installClientLog()

if (!import.meta.env.DEV) registerSW({ immediate: true })

// Referral link: remembered only for a browser that has no account yet, then removed from the address bar.
const captured = captureInvite(location.search, !!getJwt())
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

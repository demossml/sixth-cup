import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { AppProvider } from './lib/app'
import './styles.css'

if (!import.meta.env.DEV) registerSW({ immediate: true })

const invite = new URLSearchParams(location.search).get('invite')
if (invite) localStorage.setItem('sc-invite', invite)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>,
)

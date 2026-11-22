import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import '@sixth-cup/ui-tokens/tokens.css'
import '@sixth-cup/ui-tokens/steel.css'
import './styles/fonts-audit.css'
import './styles/coffee.css'
import './styles.css'
import './styles/menuLayout.css'
import BaristaAdmin from './barista/BaristaAdmin'

const root = ReactDOM.createRoot(document.getElementById('root')!)
const isBaristaRoute = /^\/barista(?:\/|$)/.test(window.location.pathname)

root.render(
  <React.StrictMode>
    {isBaristaRoute ? (
      <BaristaAdmin />
    ) : (
      <HashRouter>
        <App />
      </HashRouter>
    )}
  </React.StrictMode>,
)

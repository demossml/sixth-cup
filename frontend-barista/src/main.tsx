import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import '@sixth-cup/ui-tokens/tokens.css'
import '@sixth-cup/ui-tokens/steel.css'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

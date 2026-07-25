import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter' // self-hosted Inter (all weights via variable axis)
import '@fontsource-variable/source-serif-4' // self-hosted editorial serif (display headlines)
import './index.css'
import './dashboard/dashboard.css' // dashboard-only `dash-` tokens — MUST load after index.css
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter' // self-hosted Inter (all weights via variable axis)
import '@fontsource-variable/source-serif-4' // self-hosted editorial serif (display headlines)
import './index.css'
import './dashboard/dashboard.css' // dashboard-only `dash-` tokens — MUST load after index.css
import App from './App.tsx'
import { switchDemoRole } from './auth/authStore'
import { requestedRole } from './shell/embed'

// A host page (public/mychart.html) can pin the identity with `?as=patient`.
// Applied BEFORE the first render on purpose: done in an effect, RequireRole
// would already have bounced to sign-in on the render before it landed.
const asRole = requestedRole()
if (asRole) switchDemoRole(asRole)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

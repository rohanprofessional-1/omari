import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter' // self-hosted Inter (all weights via variable axis)
import '@fontsource-variable/source-serif-4' // self-hosted editorial serif (display headlines)
import '../index.css'
import './dashboard.css' // dashboard-only `dash-` tokens — must load after index.css
import DashboardPage from './DashboardPage'

/**
 * Standalone entry for the referral-review dashboard — its own page at
 * /dashboard/, separate from the main Omari app shell. Same design tokens,
 * same tree engine underneath; only the chrome differs.
 */
function StandaloneDashboard() {
  return (
    <div className="flex h-screen flex-col bg-dash-bg text-dash-ink">
      <header className="omari-enter-bar relative z-10 flex h-14 shrink-0 items-center gap-3 border-b border-dash-line bg-dash-surface pl-2 pr-4">
        <a href="/" className="flex items-center" title="Open the main Omari app">
          <img src="/omari-logo.png" alt="" aria-hidden className="h-12 w-12 object-contain" />
          <span className="-ml-0.5 font-serif text-dash-title tracking-tight text-dash-accent-strong">
            Omari
          </span>
        </a>
        <span className="h-5 w-px bg-dash-line" aria-hidden />
        <span className="text-dash-body font-semibold text-dash-ink">Referral Review</span>
        <a
          href="/"
          className="ml-auto rounded-dash-ctl px-3 py-1 text-dash-micro font-medium text-dash-muted transition-colors hover:bg-dash-bg hover:text-dash-ink"
        >
          Open Omari →
        </a>
      </header>
      <main className="min-h-0 flex-1">
        <DashboardPage />
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StandaloneDashboard />
  </StrictMode>,
)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter' // self-hosted Inter (all weights via variable axis)
import '@fontsource-variable/source-serif-4' // self-hosted editorial serif (display headlines)
import '../index.css'
import DashboardPage from './DashboardPage'

/**
 * Standalone entry for the referral-review dashboard — its own page at
 * /dashboard/, separate from the main Omari app shell. Same design tokens,
 * same tree engine underneath; only the chrome differs.
 */
function StandaloneDashboard() {
  return (
    <div className="flex h-screen flex-col bg-bg text-ink">
      <header className="omari-enter-bar relative z-10 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-canvas pl-2 pr-4">
        <a href="/" className="flex items-center" title="Open the main Omari app">
          <img src="/omari-logo.png" alt="" aria-hidden className="h-12 w-12 object-contain" />
          <span className="-ml-0.5 font-serif text-[19px] font-semibold tracking-tight text-accent-strong">
            Omari
          </span>
        </a>
        <span className="h-5 w-px bg-line" aria-hidden />
        <span className="text-[13px] font-semibold text-ink">Referral Review</span>
        <a
          href="/"
          className="ml-auto rounded-md px-2.5 py-1 text-[12px] font-medium text-muted hover:bg-bg hover:text-ink"
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

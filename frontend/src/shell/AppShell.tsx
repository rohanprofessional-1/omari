import { Outlet } from 'react-router-dom'
import TopBar from './TopBar'

/**
 * The chrome every signed-in screen sits inside: one app bar, one scroll-owning
 * main. Screens that need their own scroll (the tree Builder canvas, the
 * referral queue's sticky group headers) get `min-h-0 flex-1` here and manage
 * it themselves — same contract the old App.tsx <main> had.
 */
export default function AppShell() {
  return (
    <div className="flex h-screen flex-col bg-bg text-ink">
      <TopBar />
      <main className="min-h-0 flex-1">
        <Outlet />
      </main>
    </div>
  )
}

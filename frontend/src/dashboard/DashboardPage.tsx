import { useEffect, useState } from 'react'
import AdminBar from './components/AdminBar'
import RoleSwitcher from './components/RoleSwitcher'
import DetailScreen from './components/detail/DetailScreen'
import QueueScreen from './components/queue/QueueScreen'
import SurgeonScreen from './components/surgeon/SurgeonScreen'
import WorkupScreen from './components/workup/WorkupScreen'
import { useDashboardStore } from './lib/reviewStore'
import type { Role } from './types'

/**
 * Referral-review dashboard shell. No router — the same view-state idiom as
 * App.tsx: an internal segmented nav (Queue / Surgeon / Workup) plus a detail
 * view opened from any list. The role switcher sets the default view for
 * that role's workflow; the admin role also gets a demo-administration bar.
 */

type View = 'queue' | 'detail' | 'surgeon' | 'workup'

const NAV: { id: Exclude<View, 'detail'>; label: string }[] = [
  { id: 'queue', label: 'Queue' },
  { id: 'surgeon', label: 'Surgeon' },
  { id: 'workup', label: 'Workup' },
]

const DEFAULT_VIEW: Record<Role, View> = {
  coordinator: 'queue',
  surgeon: 'surgeon',
  admin: 'queue',
}

/** One-line purpose subtitle per view — the queue's header idiom everywhere. */
const SUBTITLES: Record<Exclude<View, 'detail'>, string> = {
  queue: 'Incoming referrals triaged by the clinic decision tree — confirm, correct, or reject.',
  surgeon: 'Only the exceptions that need your call — everything else was handled without you.',
  workup:
    'Approved referrals with pre-visit tests outstanding — sorted by risk so nothing falls through.',
}

const BACK_LABELS: Record<Exclude<View, 'detail'>, string> = {
  queue: '← Queue',
  surgeon: '← Surgeon brief',
  workup: '← Workup',
}

export default function DashboardPage() {
  const { role } = useDashboardStore()
  const [view, setView] = useState<View>(DEFAULT_VIEW[role])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** Which list the open detail came from — back returns there. */
  const [cameFrom, setCameFrom] = useState<Exclude<View, 'detail'>>('queue')

  // Switching role jumps to that role's home view.
  useEffect(() => {
    setView(DEFAULT_VIEW[role])
    setSelectedId(null)
  }, [role])

  const openReferral = (referralId: string) => {
    setCameFrom(view === 'detail' ? cameFrom : (view as Exclude<View, 'detail'>))
    setSelectedId(referralId)
    setView('detail')
  }

  const navActive = view === 'detail' ? cameFrom : view

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Page header */}
      <div className="border-b border-dash-line bg-dash-surface">
        <div className="mx-auto flex w-full max-w-dash-page flex-wrap items-center gap-3 px-6 py-3">
          <div className="min-w-0">
            <h1 className="text-dash-title text-dash-ink">Referral Review</h1>
            <p className="truncate text-dash-micro text-dash-muted">{SUBTITLES[navActive]}</p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-3">
            {/* Primary view tabs — the one accent family */}
            <nav className="inline-flex rounded-dash-ctl border border-dash-line bg-dash-bg p-1">
              {NAV.map((item) => {
                const active = navActive === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => setView(item.id)}
                    aria-current={active ? 'page' : undefined}
                    className={
                      'rounded-dash-ctl px-3 py-1 text-dash-micro font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-dash-accent ' +
                      (active
                        ? 'bg-dash-accent-strong text-white'
                        : 'text-dash-muted hover:text-dash-ink')
                    }
                  >
                    {item.label}
                  </button>
                )
              })}
            </nav>
            <RoleSwitcher />
          </div>
        </div>
      </div>

      {/* Demo administration — admin role only */}
      {role === 'admin' && <AdminBar />}

      {/* Body — the page owns its scroll; sticky group headers stick to it */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {view === 'queue' ? (
          <QueueScreen onOpen={openReferral} />
        ) : view === 'surgeon' ? (
          <SurgeonScreen onOpen={openReferral} />
        ) : view === 'workup' ? (
          <WorkupScreen onOpen={openReferral} />
        ) : selectedId ? (
          <DetailScreen
            referralId={selectedId}
            onBack={() => setView(cameFrom)}
            backLabel={BACK_LABELS[cameFrom]}
          />
        ) : (
          <QueueScreen onOpen={openReferral} />
        )}
      </div>
    </div>
  )
}

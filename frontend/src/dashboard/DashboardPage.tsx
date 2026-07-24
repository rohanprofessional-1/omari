import { useEffect, useState } from 'react'
import RoleSwitcher from './components/RoleSwitcher'
import DetailScreen from './components/detail/DetailScreen'
import QueueScreen from './components/queue/QueueScreen'
import SectionCard from './components/shared/SectionCard'
import SurgeonScreen from './components/surgeon/SurgeonScreen'
import { useDashboardStore } from './lib/reviewStore'
import type { Role } from './types'

/**
 * Referral-review dashboard shell. No router — the same view-state idiom as
 * App.tsx: an internal segmented nav (Queue / Surgeon / Workup) plus a detail
 * view opened from queue rows. The role switcher sets the default view for
 * that role's workflow.
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
      <div className="border-b border-line bg-canvas px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <h1 className="font-serif text-[17px] font-semibold text-ink">Referral Review</h1>
            <p className="text-[11.5px] text-muted">
              Incoming referrals triaged by the clinic decision tree — confirm, correct, or reject.
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <nav className="inline-flex rounded-lg border border-line bg-bg p-0.5">
              {NAV.map((item) => {
                const active = navActive === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => setView(item.id)}
                    aria-current={active ? 'page' : undefined}
                    className={
                      'rounded-[7px] px-2.5 py-1 text-[12px] font-medium transition-colors ' +
                      (active
                        ? 'bg-accent-strong text-white shadow-[0_1px_2px_rgba(31,36,33,0.10)]'
                        : 'text-muted hover:text-ink')
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

      {/* Body — the page owns its scroll; sticky group headers stick to it */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {view === 'queue' ? (
          <QueueScreen onOpen={openReferral} />
        ) : view === 'surgeon' ? (
          <SurgeonScreen onOpen={openReferral} />
        ) : view === 'detail' && selectedId ? (
          <DetailScreen
            referralId={selectedId}
            onBack={() => setView(cameFrom)}
            backLabel={cameFrom === 'surgeon' ? '← Surgeon brief' : '← Queue'}
          />
        ) : (
          <div className="mx-auto max-w-3xl px-4 py-6">
            <SectionCard title="Workup tracking">
              <p className="text-[13px] text-muted">Coming in a later step.</p>
            </SectionCard>
          </div>
        )}
      </div>
    </div>
  )
}

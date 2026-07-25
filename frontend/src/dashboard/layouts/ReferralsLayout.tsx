import { NavLink, Outlet, useLocation } from 'react-router-dom'
import AdminBar from '../components/AdminBar'
import { useDashboardStore } from '../lib/reviewStore'
import type { Role } from '../types'

/**
 * The referral section's own chrome: title, purpose subtitle, and the second
 * level of navigation. Admin and surgeon share this component — only the
 * sub-tabs and the demo AdminBar differ.
 *
 * This replaces DashboardPage's useState view switching. The detail screen is
 * a sibling route (`referrals/:referralId`) rather than a fourth view, so the
 * URL, the back button, and deep links all work.
 */

interface SubTab {
  /** Relative to the section route, e.g. /admin/referrals. */
  to: string
  label: string
  subtitle: string
}

const ADMIN_TABS: SubTab[] = [
  {
    to: 'queue',
    label: 'Queue',
    subtitle:
      'Incoming referrals triaged by the clinic decision tree — confirm, correct, or reject.',
  },
  {
    to: 'escalations',
    label: 'Escalations',
    subtitle: 'Referrals the tree or a reviewer flagged for a surgeon’s judgment.',
  },
  {
    to: 'workup',
    label: 'Workup',
    subtitle:
      'Approved referrals with pre-visit tests outstanding — sorted by risk so nothing falls through.',
  },
]

const SURGEON_TABS: SubTab[] = [
  {
    to: 'cases',
    label: 'My cases',
    subtitle: 'Referrals routed to you — everything else is handled without you.',
  },
  {
    to: 'escalations',
    label: 'Escalations',
    subtitle: 'Only the exceptions that need your call — everything else was handled without you.',
  },
  {
    to: 'workup',
    label: 'Workup',
    subtitle: 'Your approved referrals with pre-visit tests outstanding, sorted by risk.',
  },
]

const TABS: Record<Role, SubTab[]> = {
  admin: ADMIN_TABS,
  surgeon: SURGEON_TABS,
  // Patients never reach this section — RequireRole stops them — but the map
  // must be total.
  patient: [],
}

const TITLES: Record<Role, string> = {
  admin: 'Referral Review',
  surgeon: 'My Referrals',
  patient: 'Referrals',
}

export default function ReferralsLayout() {
  const { role } = useDashboardStore()
  const { pathname } = useLocation()
  const tabs = TABS[role]

  // The active sub-tab, or none when a detail screen is open. Detail keeps the
  // subtitle of wherever you came from feeling wrong, so it gets its own line.
  const slug = pathname.split('/').filter(Boolean).pop()
  const active = tabs.find((t) => t.to === slug)

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Page header */}
      <div className="border-b border-dash-line bg-dash-surface">
        <div className="mx-auto flex w-full max-w-dash-page flex-wrap items-center gap-3 px-6 py-3">
          <div className="min-w-0">
            <h1 className="text-dash-title text-dash-ink">{TITLES[role]}</h1>
            <p className="truncate text-dash-micro text-dash-muted">
              {active?.subtitle ?? 'One referral in full — what came in, and what the tree concluded.'}
            </p>
          </div>
          <nav className="ml-auto inline-flex rounded-dash-ctl border border-dash-line bg-dash-bg p-1">
            {tabs.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                className={({ isActive }) =>
                  'rounded-dash-ctl px-3 py-1 text-dash-micro font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-dash-accent ' +
                  (isActive
                    ? 'bg-dash-accent-strong text-white'
                    : 'text-dash-muted hover:text-dash-ink')
                }
              >
                {tab.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </div>

      {/* Demo administration — admin only */}
      {role === 'admin' && <AdminBar />}

      {/* Body — owns its scroll; sticky group headers stick to it */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  )
}

import { NavLink, Outlet } from 'react-router-dom'
import { useDashboardStore } from '../lib/reviewStore'
import type { Role } from '../types'

/**
 * The referral section's own chrome: title and the second level of
 * navigation. Admin and surgeon share this component — only the sub-tabs and
 * the demo AdminBar differ.
 *
 * This replaces DashboardPage's useState view switching. The detail screen is
 * a sibling route (`referrals/:referralId`) rather than a fourth view, so the
 * URL, the back button, and deep links all work.
 */

interface SubTab {
  /** Relative to the section route, e.g. /admin/referrals. */
  to: string
  label: string
}

const ADMIN_TABS: SubTab[] = [
  { to: 'queue', label: 'Queue' },
  { to: 'escalations', label: 'Escalations' },
  { to: 'workup', label: 'Workup' },
]

const SURGEON_TABS: SubTab[] = [
  { to: 'cases', label: 'My cases' },
  { to: 'escalations', label: 'Escalations' },
  { to: 'workup', label: 'Workup' },
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
  const tabs = TABS[role]

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Page header — title and section nav only. The tier bands below carry
          the explanation, so a purpose subtitle here was duplicate chrome. */}
      <div className="border-b border-dash-line-strong bg-dash-surface">
        <div className="mx-auto flex w-full max-w-dash-page flex-wrap items-center gap-3 px-6 py-3">
          <h1 className="min-w-0 truncate text-dash-title text-dash-ink">{TITLES[role]}</h1>
          <nav className="ml-auto inline-flex rounded-dash-ctl border border-dash-line-strong bg-dash-bg p-0.5">
            {tabs.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                className={({ isActive }) =>
                  'rounded-dash-ctl px-3 py-1 text-dash-micro font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-dash-accent ' +
                  (isActive
                    ? 'bg-dash-surface text-dash-ink shadow-dash-card'
                    : 'text-dash-muted hover:text-dash-ink')
                }
              >
                {tab.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </div>

      {/* Body — owns its scroll; sticky group headers stick to it */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  )
}

import type { Role } from '../types'
import { useDashboardStore } from '../lib/reviewStore'
import Badge from './shared/Badge'

/**
 * Demo affordance — switches the reviewing role (coordinator / surgeon /
 * admin). Deliberately muted next to the accent view tabs: neutral DEMO tag,
 * hairline segmented control, white (not accent) active state — clearly not
 * product chrome.
 */

const ROLES: { id: Role; label: string }[] = [
  { id: 'admin', label: 'Admin' },
  { id: 'surgeon', label: 'Surgeon' },
  { id: 'patient', label: 'Patient' },
]

export default function RoleSwitcher() {
  const { role, setRole } = useDashboardStore()
  return (
    <div
      className="flex items-center gap-2"
      title="Demo affordance — switches the reviewing role"
    >
      <Badge tone="neutral" className="font-semibold">
        DEMO
      </Badge>
      <div className="inline-flex rounded-dash-ctl border border-dash-line bg-dash-bg p-1">
        {ROLES.map((r) => {
          const active = role === r.id
          return (
            <button
              key={r.id}
              onClick={() => setRole(r.id)}
              aria-pressed={active}
              className={
                'rounded-dash-ctl px-2 py-1 text-dash-micro font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-dash-accent ' +
                (active
                  ? 'bg-dash-surface text-dash-ink shadow-dash-card'
                  : 'text-dash-faint hover:text-dash-ink')
              }
            >
              {r.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

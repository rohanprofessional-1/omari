import type { Role } from '../types'
import { useDashboardStore } from '../lib/reviewStore'

/**
 * Demo affordance — switches the reviewing role (coordinator / surgeon /
 * admin). Clones the TopNav segmented-pill idiom at dashboard scale.
 */

const ROLES: { id: Role; label: string }[] = [
  { id: 'coordinator', label: 'Coordinator' },
  { id: 'surgeon', label: 'Surgeon' },
  { id: 'admin', label: 'Admin' },
]

export default function RoleSwitcher() {
  const { role, setRole } = useDashboardStore()
  return (
    <div
      className="flex items-center gap-1.5"
      title="Demo affordance — switches the reviewing role"
    >
      <span className="rounded bg-sky px-1.5 py-0.5 text-[10.5px] font-semibold text-accent-strong">
        DEMO
      </span>
      <div className="inline-flex rounded-lg border border-line bg-bg p-0.5">
        {ROLES.map((r) => {
          const active = role === r.id
          return (
            <button
              key={r.id}
              onClick={() => setRole(r.id)}
              aria-pressed={active}
              className={
                'rounded-[7px] px-2.5 py-1 text-[12px] font-medium transition-colors ' +
                (active
                  ? 'bg-accent-strong text-white shadow-[0_1px_2px_rgba(31,36,33,0.10)]'
                  : 'text-muted hover:text-ink')
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

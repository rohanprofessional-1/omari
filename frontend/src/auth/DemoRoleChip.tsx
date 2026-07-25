import { useNavigate } from 'react-router-dom'
import { ROLES, type Role } from '../types/roles'
import { homeFor } from '../shell/nav'
import { useAuth } from './authStore'

/**
 * DEMO affordance — jump between the three views without signing out and back
 * in. Replaces the dashboard's old RoleSwitcher.
 *
 * Deliberately muted next to the accent section nav: neutral DEMO tag, hairline
 * segmented control, white (not accent) active state. It should read as stage
 * equipment, not product chrome — and it disappears with demoUsers.ts when real
 * auth lands.
 */

const LABELS: Record<Role, string> = {
  admin: 'Admin',
  surgeon: 'Surgeon',
  patient: 'Patient',
}

export default function DemoRoleChip() {
  const { user, switchDemoRole } = useAuth()
  const navigate = useNavigate()

  if (!user) return null

  const jump = (role: Role) => {
    if (role === user.role) return
    switchDemoRole(role)
    navigate(homeFor(role))
  }

  return (
    <div className="flex items-center gap-2" title="Demo affordance — switches the signed-in role">
      <span className="rounded bg-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
        Demo
      </span>
      <div className="inline-flex rounded-lg border border-line bg-bg p-0.5">
        {ROLES.map((role) => {
          const active = user.role === role
          return (
            <button
              key={role}
              onClick={() => jump(role)}
              aria-pressed={active}
              className={
                'rounded-md px-2 py-1 text-[12px] font-medium transition-colors ' +
                (active
                  ? 'bg-canvas text-ink shadow-subtle'
                  : 'text-muted hover:text-ink')
              }
            >
              {LABELS[role]}
            </button>
          )
        })}
      </div>
    </div>
  )
}

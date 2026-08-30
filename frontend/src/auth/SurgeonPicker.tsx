import { useAuth } from './authStore'
import { DEMO_USERS } from './demoUsers'
import type { User } from './types'

/**
 * SurgeonPicker — dropdown to switch between specialist views.
 *
 * Shown in the top bar when the current role is 'surgeon'. Selecting a
 * specialist logs you in as them so their scoped referral queue loads.
 * All specialist destinations from the routing tree are available.
 */

const SURGEONS = DEMO_USERS.filter((u): u is User & { specialistName: string } =>
  u.role === 'surgeon' && !!u.specialistName
)

export default function SurgeonPicker() {
  const { user, signIn } = useAuth()

  if (!user || user.role !== 'surgeon') return null

  const switchTo = async (email: string) => {
    if (email === user.email) return
    await signIn(email, 'omari')
  }

  return (
    <div className="flex items-center gap-2" title="Switch specialist view">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
        Viewing as
      </span>
      <select
        value={user.email}
        onChange={(e) => switchTo(e.target.value)}
        className="rounded-md border border-line bg-bg px-2 py-1 text-[12px] font-medium text-ink focus:border-accent-strong focus:outline-none focus:ring-1 focus:ring-accent-strong/20"
      >
        {SURGEONS.map((s) => (
          <option key={s.id} value={s.email}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  )
}

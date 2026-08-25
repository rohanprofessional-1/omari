import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/authStore'
import { isEmbedded } from './embed'
import { SECTIONS } from './nav'

/**
 * Slim global app bar: wordmark + the signed-in role's section nav on the left,
 * the DEMO role chip, and the Settings + account controls on the right.
 *
 * Which sections appear is a function of `user.role` alone (see ./nav.ts).
 * Hiding a section is a convenience, not a boundary — RequireRole guards the
 * routes themselves.
 *
 * EMBEDDED (see ./embed.ts), the identity furniture comes off: the host page
 * already has a wordmark, an account and a patient banner, and repeating them
 * makes Omari look pasted on rather than built in. The section nav stays —
 * that is the app's own navigation, one level below the host's.
 */
export default function TopBar() {
  const { user } = useAuth()
  const sections = user ? SECTIONS[user.role] : []

  return (
    <header
      className={`omari-enter-bar relative z-50 flex shrink-0 items-center gap-4 border-b border-line bg-canvas pr-4 ${
        isEmbedded ? 'h-12 pl-4' : 'h-14 pl-2'
      }`}
    >
      {/* Wordmark — Omari logo mark + name (tight, single unit, logo navy) */}
      {!isEmbedded && (
        <Link to="/" className="flex items-center" title="Omari">
          <img src="/omari-logo.png" alt="" aria-hidden className="h-12 w-12 object-contain" />
          <span className="-ml-0.5 font-serif text-[19px] font-semibold tracking-tight text-accent-strong">
            Omari
          </span>
        </Link>
      )}

      {/* Segmented section nav — driven entirely by role */}
      {sections.length > 0 && (
        <nav className="inline-flex rounded-lg border border-line bg-bg p-0.5">
          {sections.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                'rounded-md px-3 py-1 text-sm font-medium transition-colors ' +
                (isActive
                  ? 'bg-accent-strong text-white shadow-subtle'
                  : 'text-muted hover:text-ink')
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      )}

      {!isEmbedded && (
        <div className="ml-auto flex items-center gap-3">
          <AccountTools />
        </div>
      )}
    </header>
  )
}

/* -------------------------------------------------------------------------- */
/* Right-side cluster: Settings menu + account                                */
/* -------------------------------------------------------------------------- */

function AccountTools() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [menu, setMenu] = useState<null | 'settings' | 'account'>(null)
  const [reduceMotion, setReduceMotion] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem('omari:reduce-motion') === '1',
  )
  const wrapRef = useRef<HTMLDivElement>(null)

  // Apply + persist the reduce-motion preference (a real, working setting).
  useEffect(() => {
    document.documentElement.classList.toggle('omari-reduce-motion', reduceMotion)
    localStorage.setItem('omari:reduce-motion', reduceMotion ? '1' : '0')
  }, [reduceMotion])

  // Dismiss any open menu on outside click / Escape.
  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenu(null)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const toggle = (which: 'settings' | 'account') =>
    setMenu((m) => (m === which ? null : which))

  const initial = (user?.name.trim()[0] || 'U').toUpperCase()

  return (
    <div ref={wrapRef} className="flex items-center gap-1.5">
      {/* Settings */}
      <div className="relative">
        <button
          aria-label="Settings"
          aria-haspopup="menu"
          aria-expanded={menu === 'settings'}
          onClick={() => toggle('settings')}
          className={`grid h-8 w-8 place-items-center rounded-md border transition-colors ${
            menu === 'settings'
              ? 'border-accent-strong/50 bg-sky text-accent-strong'
              : 'border-line text-muted hover:bg-bg hover:text-accent-strong'
          }`}
        >
          <GearIcon />
        </button>
        {menu === 'settings' && (
          <Dropdown>
            <p className="px-2.5 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              Settings
            </p>
            <ToggleRow
              label="Reduce motion"
              hint="Calmer — fewer animations"
              on={reduceMotion}
              onChange={() => setReduceMotion((v) => !v)}
            />
            <Divider />
            <MenuItem onClick={() => setMenu(null)} icon={<KeyboardIcon />}>
              Keyboard shortcuts
            </MenuItem>
            <MenuItem onClick={() => setMenu(null)} icon={<HelpIcon />}>
              Help &amp; docs
            </MenuItem>
          </Dropdown>
        )}
      </div>

      {/* Account */}
      <div className="relative">
        {user ? (
          <button
            aria-label="Account"
            aria-haspopup="menu"
            aria-expanded={menu === 'account'}
            onClick={() => toggle('account')}
            className="grid h-8 w-8 place-items-center rounded-full bg-accent-strong text-[12px] font-semibold text-white transition-transform hover:scale-105"
          >
            {initial}
          </button>
        ) : (
          <Link
            to="/signin"
            className="inline-flex items-center gap-1.5 rounded-md border border-accent-strong/40 bg-canvas px-3 py-1.5 text-[13px] font-medium text-accent-strong transition-colors hover:border-accent-strong/70 hover:bg-sky"
          >
            <UserIcon />
            Sign in
          </Link>
        )}

        {menu === 'account' && user && (
          <Dropdown>
            <div className="flex items-center gap-2.5 px-2.5 py-2">
              <div className="flex w-8 h-8 items-center justify-center rounded-full bg-dash-accent-soft text-dash-accent-strong text-dash-body font-semibold">
                {user.name.charAt(0).toUpperCase()}
              </div>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium text-ink">{user.name}</span>
                <span className="block truncate text-[11px] text-muted">{user.email}</span>
              </span>
            </div>
            <div className="px-2.5 pb-1.5">
              <span className="rounded bg-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                {user.role}
              </span>
            </div>
            <Divider />
            <MenuItem onClick={() => setMenu('settings')} icon={<GearIcon />}>
              Settings
            </MenuItem>
            <Divider />
            <MenuItem
              onClick={() => {
                setMenu(null)
                signOut()
                navigate('/signin', { replace: true })
              }}
              icon={<SignOutIcon />}
              danger
            >
              Sign out
            </MenuItem>
          </Dropdown>
        )}
      </div>
    </div>
  )
}

/* ── Small presentational primitives ─────────────────────────────────────── */

function Dropdown({ children, width = 'w-60' }: { children: ReactNode; width?: string }) {
  return (
    <div
      role="menu"
      className={`omari-msg absolute right-0 top-full z-50 mt-2 ${width} rounded-xl border border-line bg-canvas p-1.5 shadow-subtle`}
    >
      {children}
    </div>
  )
}

function Divider() {
  return <div className="my-1 h-px bg-line" aria-hidden />
}

function MenuItem({
  children,
  icon,
  onClick,
  danger,
}: {
  children: ReactNode
  icon?: ReactNode
  onClick?: () => void
  danger?: boolean
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors ${
        danger ? 'text-danger hover:bg-danger/8' : 'text-ink hover:bg-bg'
      }`}
    >
      {icon && <span className="shrink-0 text-muted">{icon}</span>}
      {children}
    </button>
  )
}

function ToggleRow({
  label,
  hint,
  on,
  onChange,
}: {
  label: string
  hint?: string
  on: boolean
  onChange: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-1.5">
      <span className="min-w-0">
        <span className="block text-[13px] text-ink">{label}</span>
        {hint && <span className="block text-[11px] text-muted">{hint}</span>}
      </span>
      <button
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={onChange}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          on ? 'bg-accent-strong' : 'bg-line'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
            on ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  )
}

/* ── Icons (small stroke set) ────────────────────────────────────────────── */

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

const GearIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </Svg>
)

const UserIcon = () => (
  <Svg>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </Svg>
)

const SignOutIcon = () => (
  <Svg>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5M21 12H9" />
  </Svg>
)

const KeyboardIcon = () => (
  <Svg>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
  </Svg>
)

const HelpIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="10" />
    <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" />
  </Svg>
)

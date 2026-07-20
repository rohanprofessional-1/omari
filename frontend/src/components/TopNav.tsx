import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Page } from '../App'

interface TopAppBarProps {
  page: Page
  onNavigate: (page: Page) => void
}

const links: { id: Page; label: string }[] = [
  { id: 'generate', label: 'Generate' },
  { id: 'builder', label: 'Builder' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'runner', label: 'Runner' },
  { id: 'knowledge', label: 'Knowledge' },
]

/**
 * Slim global app bar: wordmark + Builder/Runner page nav on the left, and the
 * Settings + account/login controls on the right (the space freed up when the
 * tree actions moved into the canvas toolbar).
 */
function TopAppBar({ page, onNavigate }: TopAppBarProps) {
  return (
    <header className="omari-enter-bar relative z-10 flex h-14 shrink-0 items-center gap-4 border-b border-line bg-canvas pl-2 pr-4">
      {/* Wordmark — Omari logo mark + name (tight, single unit, logo navy) */}
      <span className="flex items-center">
        <img src="/omari-logo.png" alt="" aria-hidden className="h-12 w-12 object-contain" />
        <span className="-ml-0.5 font-serif text-[19px] font-semibold tracking-tight text-accent-strong">
          Omari
        </span>
      </span>

      {/* Segmented page nav */}
      <nav className="inline-flex rounded-lg border border-line bg-bg p-0.5">
        {links.map((link) => {
          const active = page === link.id
          return (
            <button
              key={link.id}
              onClick={() => onNavigate(link.id)}
              aria-current={active ? 'page' : undefined}
              className={
                'rounded-[7px] px-3 py-1 text-sm font-medium transition-colors ' +
                (active
                  ? 'bg-accent-strong text-white shadow-[0_1px_2px_rgba(31,36,33,0.10)]'
                  : 'text-muted hover:text-ink')
              }
            >
              {link.label}
            </button>
          )
        })}
      </nav>

      <AccountTools />
    </header>
  )
}

/* -------------------------------------------------------------------------- */
/* Right-side cluster: Settings menu + account / login                        */
/* -------------------------------------------------------------------------- */

const DEMO_EMAIL = 'gkancharla@gmail.com'

function AccountTools() {
  const [menu, setMenu] = useState<null | 'settings' | 'account'>(null)
  const [signedIn, setSignedIn] = useState(false)
  const [email, setEmail] = useState(DEMO_EMAIL)
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

  const initial = (email.trim()[0] || 'U').toUpperCase()

  return (
    <div ref={wrapRef} className="ml-auto flex items-center gap-1.5">
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

      {/* Account / login */}
      <div className="relative">
        {signedIn ? (
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
          <button
            onClick={() => toggle('account')}
            className="inline-flex items-center gap-1.5 rounded-md border border-accent-strong/40 bg-canvas px-3 py-1.5 text-[13px] font-medium text-accent-strong transition-colors hover:border-accent-strong/70 hover:bg-sky"
          >
            <UserIcon />
            Sign in
          </button>
        )}

        {menu === 'account' &&
          (signedIn ? (
            <Dropdown>
              <div className="flex items-center gap-2.5 px-2.5 py-2">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-strong text-sm font-semibold text-white">
                  {initial}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-ink">
                    Omari account
                  </span>
                  <span className="block truncate text-[11px] text-muted">{email}</span>
                </span>
              </div>
              <Divider />
              <MenuItem onClick={() => setMenu(null)} icon={<UserIcon />}>
                Profile
              </MenuItem>
              <MenuItem onClick={() => setMenu('settings')} icon={<GearIcon />}>
                Settings
              </MenuItem>
              <Divider />
              <MenuItem
                onClick={() => {
                  setSignedIn(false)
                  setMenu(null)
                }}
                icon={<SignOutIcon />}
                danger
              >
                Sign out
              </MenuItem>
            </Dropdown>
          ) : (
            <SignInForm
              email={email}
              setEmail={setEmail}
              onSignIn={() => {
                if (!email.trim()) setEmail(DEMO_EMAIL)
                setSignedIn(true)
                setMenu(null)
              }}
            />
          ))}
      </div>
    </div>
  )
}

/* ── Small presentational primitives ─────────────────────────────────────── */

function Dropdown({ children, width = 'w-60' }: { children: ReactNode; width?: string }) {
  return (
    <div
      role="menu"
      className={`omari-msg absolute right-0 top-full z-50 mt-2 ${width} rounded-xl border border-line bg-canvas p-1.5 shadow-[0_10px_30px_rgba(24,20,16,0.14)]`}
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

function SignInForm({
  email,
  setEmail,
  onSignIn,
}: {
  email: string
  setEmail: (v: string) => void
  onSignIn: () => void
}) {
  const [password, setPassword] = useState('')
  const input =
    'w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[13px] text-ink placeholder:text-muted/70 focus:border-accent-strong focus:outline-none focus:ring-2 focus:ring-accent-strong/15'
  return (
    <Dropdown width="w-72">
      <form
        className="p-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          onSignIn()
        }}
      >
        <p className="px-1 pb-2 text-[13px] font-semibold text-ink">Sign in to Omari</p>
        <label className="mb-2 block">
          <span className="mb-1 block text-[11px] font-medium text-muted">Email</span>
          <input
            type="email"
            className={input}
            placeholder="you@clinic.org"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </label>
        <label className="mb-3 block">
          <span className="mb-1 block text-[11px] font-medium text-muted">Password</span>
          <input
            type="password"
            className={input}
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button
          type="submit"
          className="w-full rounded-md bg-accent-strong px-3 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-[#24489c]"
        >
          Sign in
        </button>
        <p className="px-1 pt-2 text-center text-[10.5px] text-muted">
          Demo sign-in — no account is created.
        </p>
      </form>
    </Dropdown>
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

export default TopAppBar
